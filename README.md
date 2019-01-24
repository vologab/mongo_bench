## MongoDb aggregation benchmarks

## How to run
1. Define env variables

See .env.sample

2. Generate data

```bash
GENERATE_DATA=true RUN_BENCHMARK=false node -r dotenv/config index.js
```

3. Run and save benchmark data

```bash
GENERATE_DATA=false RUN_BENCHMARK=true node -r dotenv/config index.js > report.csv
``