## MongoDb aggregation benchmarks

### How to run
1. Define env variables

See .env.sample

2. Generate data

```bash
GENERATE_DATA=true RUN_BENCHMARK=false ts-node -r dotenv/config index.ts
```

3. Run and save benchmark data

```bash
GENERATE_DATA=false RUN_BENCHMARK=true ts-node -r dotenv/config index.ts > report.csv
``