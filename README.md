# Welcome!

At [Schub Space](https://www.schub.tech) we have some teams shipping their lovable projects to production. Here are our notes how we tackled the challenges we faced along the way. Feel free to contribute via pull requests.

## Table of Content

- [Deploying to production](#deploying-to-production)
- [Separate databases supabase accounts](#separate-databases-supabase-accounts)
- [Create tests](#create-tests)

## Deploying to production

We choose AWS S3 to host our applications alongside deployment via Github actions.

### Setting up AWS

Despite there being many ways to deploy a react app (that's what the lovable apps technically are) we choose to create the artefacts in AWS ourselves. In particular this is

- S3 bucket to host files
- CloudFront for SSL offloading & caching

You can follow a [guide like this](https://medium.com/@Anita-ihuman/deploying-a-react-app-using-aws-s3-and-cloud-front-c0950808bf03https:/) to setup or ask ChatGPT for steps.

### Deploy via Github Actions

As lovable commits all changes directly to the `main` branch, created a 2nd branch `prod` that contains the production code. Deploys are then triggered via pull requests from `main` to `prod` branch.

The deploy process itsels consists of:

- buiild frontend assets and copy to S3
- run database migrations
- deploy edge functions
- invalidate cloudfront cache

You can use the following template for your Github deploy action. Just copy it to [.github/deploy.yml](https://github.com/schub-tech/lovable-production/blob/main/.github/workflows/deploy.ymlhttps:/)
In the file itself, replace the following variables

- your S3 bucket name
- your CloudFront distribution Id

You also need to store some information in Supabase secrets (you'll find this under functions -> secrets in Supabase)

- VITE_SUPABASE_URL - your production url
- SUPABASE_PROD_ANON_KEY - see below in the [Supabase account section](#Separate-databases-supabase-accounts)
- SUPABASE_PROD_PROJECT_ID - your Supabase project id
- SUPABASE_PROD_ACCESS_TOKEN - see below in the [Supabase account section](#Separate-databases-supabase-accounts)
- SUPABASE_PROD_DB_PASSWORD - the database password you set when creating your Supabase project

```jsx
name: Deploy Application and Edge Functions

on:
  push:
    branches:
      - prod

jobs:
  deploy-app:
    name: Deploy Frontend Application
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Create .env file
        run: |
          echo "# Supabase Configuration" > .env
          echo "VITE_SUPABASE_URL=${{ secrets.SUPABASE_PROD_URL }}" >> .env
          echo "VITE_SUPABASE_ANON_KEY=${{ secrets.SUPABASE_PROD_ANON_KEY }}" >> .env

      - name: Replace project_id in config.toml
        run: |
          project_id="${{ secrets.SUPABASE_PROD_PROJECT_ID }}"
          sed -i "s|project_id = \".*\"|project_id = \"${project_id}\"|" supabase/config.toml

      - name: Install dependencies
        run: npm install

      - name: Build project
        run: npm run build

      - name: Deploy to S3
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_REGION: 'us-east-1'
          S3_BUCKET: '<<<your-bucket-name-here>>>'
        run: |
          aws s3 sync ./dist s3://$S3_BUCKET --delete
          aws s3 cp ./dist/index.html s3://$S3_BUCKET/index.html --cache-control "no-cache"

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Run Supabase Migrations
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_PROD_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_PROD_DB_PASSWORD }}
          PROJECT_ID: ${{ secrets.SUPABASE_PROD_PROJECT_ID }}
        run: |
          supabase --version
   
          supabase link --project-ref $PROJECT_ID
          supabase db push

  deploy-edge-functions:
    name: Deploy Edge Functions
    runs-on: ubuntu-latest
    needs: [deploy-app]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1

      - name: Deploy Edge Functions
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_PROD_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_PROD_DB_PASSWORD }}
          PROJECT_ID: ${{ secrets.SUPABASE_PROD_PROJECT_ID }}
        run: |
          supabase functions deploy --project-ref $PROJECT_ID

  invalidate-cache:
    name: Invalidate CloudFront Cache
    needs: [deploy-app, deploy-edge-functions]
    if: ${{ always() && !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - name: Invalidate CloudFront Cache
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          DISTRIBUTION_ID: '<<<your-cloudfront-distribution-id->>>'
        run: |
          aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"

```

Known issues:

- Supabase functions are deployed on every commit and not only upon changes to the function itself.

## Separate databases supabase accounts

A key component for using separated databases is to track database changes via migrations. This in unfortunately nothing that lovable supports automatically (as of now), but you have a few options to create them

- by hand in your favourite editor. Everytime you run a SQL statement in lovable, also put it into a migration file via copy & paste
- use the supabase command: `supabase migration new <add_column_to_table_xxx>` to create the migration file and paste the SQL into it.
- try to tell lovable to create a migrations file.

Make sure you put your migration files into `/supabase/migrations/`

If you have build your database initially without migrations, you need to create an initial migration. Either get the SQL for that via the Supabase web interface (database -> backup and then copy the the table creation statements only) or you can use `psql`.

Once you have completed these prerequisites you can create a second Supabase project as your production project. Note down the postgres password as you need to put it in a Supabase secret (see deployment section)

To enable our app choosing the right database we need to modify the `src/integrations/supabase/client.ts` in your project. Despite the warning not to edit it, we had no problems so far doing so. Do hardcode the values of your Supabase development account here (i.e. replace `<<<your-supabase-dev-account-url>>>` and `<<<supabase-anon-key>>>`). The anon key you'll find in Supabase under [Settings -> Data API](https://supabase.com/dashboard/project/_/settings/api).

```jsx

// This file is automatically generated. Do not edit it directly.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Get environment variables with fallbacks to the current hardcoded values
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "<<<your-supabase-dev-account-url>>>";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "<<<supabase-anon-key>>>";

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
```

Remark: Supabase url and anon key are publicly exposed in the frontend. The key for this being safe is to enable row level security (RLS) in your database. This is something lovable suggests and normally does for each table.

## Create tests

### How to create tests

Our approach has been to setup a local development environment, then use cursor.ai to write an intial set of tests. Thereafter we could ask lovable to create tests in a similar fashion.

To setup a local development environment, you need to create`.env file` with the following content:

```jsx
VITE_SUPABASE_URL=https://your-project-url.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

```

Then initialize a loca Supabase instance with `supabase init` and `supabase start`.

### Have automatic tests upon code pushes

You can use the following github action ([.github/workflows/playwright-tests.yml](https://github.com/schub-tech/lovable-production/blob/main/.github/workflows/playwright-tests.yml)) to have your tests automatically run on each push

```jsx

name: Playwright Tests

on:
  push:
    branches:
      - prod

jobs:
  e2e-tests:
    runs-on: ubuntu-latest

    steps:
      - name: Check out code
        uses: actions/checkout@v4

      - name: Install dependencies
        run: npm install

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest
  
      - name: Start Supabase project
        run: |
          # Initialize the Supabase project (if not already initialized)
          supabase init --force --with-intellij-settings --with-vscode-settings 

          # Start the Supabase services (Postgres, Auth, Storage)
          supabase start

      - name: Set up database schema
        run: |
          export SUPABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

          # Drop schema and reset the database (assuming schema.sql exists in 'data/schema.sql')
          # psql $SUPABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
          # psql $SUPABASE_URL -f data/schema.sql

          # Run migrations (if applicable)
          #supabase migrations up

          # insert first user
          psql $SUPABASE_URL -f tests/data/auth.users.sql 
          psql $SUPABASE_URL -f tests/data/auth.identities.sql 
          psql $SUPABASE_URL -f tests/data/profiles.sql 

      - name: Create .env file
        run: |
          echo "# Supabase Configuration" > .env
          echo "VITE_SUPABASE_URL=http://127.0.0.1:54321" >> .env
          echo "VITE_SUPABASE_ANON_KEY=$(supabase status 2>/dev/null | grep 'anon key' | awk '{print $3}')" >> .env

      - name: Install Playwright
        run: npm install @playwright/test  
      - name: Install Playwright Browsers
        run: npx playwright install chromium --with-deps
  
      - name: Run Playwright tests
        run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30

```

Note: Some of the configuration also happens in [playwright.config.ts](https://github.com/schub-tech/lovable-production/blob/main/playwright.config.ts), be sure to copy that to your repo too.
