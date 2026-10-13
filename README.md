# AutoMock AI

Self-hosted API mock + contract-testing server with a daily self-improvement loop.

    npm install
    npm start                      # mock server on :4010, dashboard at /__automock
    node src/cli.ts verify specs/petstore.json --target http://localhost:3000
    npm run verify                 # typecheck + security lint + tests

## Daily agent loop
    npm run agent:dry              # full pipeline + gates, no model calls, no commits (free)
    npm run agent:daily            # real run (needs an agent CLI; default: Claude Code, set AGENT_CMD to change)

Env: `MAX_TASKS=3` `MAX_RETRIES=1` `AUTO_MERGE=1` `BASE_BRANCH=main` `MAX_DIFF_LINES=400`
CI: `.github/workflows/daily-agent.yml` opens a PR and enables auto-merge; protect `main` and require the `verify` check.
