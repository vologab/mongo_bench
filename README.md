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
```

## Dataset

### Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "http://example.com/root.json",
  "type": "object",
  "title": "Fake object",
  "required": [
    "category",
    "date",
    "coordinates",
    "city",
    "country",
    "state",
    "zipCode",
    "countryCode",
    "geojson_location",
    "uuid",
    "flag",
    "count",
    "url",
    "version",
    "model",
    "locale"
  ],
  "properties": {
    "category": {
      "type": "string",
      "enum": ["AAA", "BBB", "CCC", "DDD"]
    },
    "date": {
      "type": "object",
      "faker": "date.past",
      "$comment": "Use object type for saving Date object to MongoDb"
    },
    "coordinates": {
      "type": "object",
      "required": ["latitude", "longitude", "accuracy"],
      "properties": {
        "latitude": {
          "type": "integer",
          "faker": "address.latitude"
        },
        "longitude": {
          "type": "number",
          "faker": "address.longitude"
        },
        "accuracy": {
          "type": "number",
          "minimum": 0,
          "maximum": 100
        }
      }
    },
    "city": {
      "type": "string",
      "faker": "address.city"
    },
    "country": {
      "type": "string",
      "faker": "address.country",
      "category1": true
    },
    "state": {
      "type": "string",
      "faker": "address.state"
    },
    "zipCode": {
      "type": "string",
      "faker": "address.zipCode"
    },
    "countryCode": {
      "type": "string",
      "faker": "address.countryCode"
    },
    "geojson_location": {
      "type": "object",
      "required": ["type", "coordinates"],
      "properties": {
        "type": {
          "type": "string",
          "enum": ["Point"]
        },
        "coordinates": {
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "items": {
            "type": "number",
            "minimum": -90,
            "maximum": 90
          }
        }
      }
    },
    "uuid": {
      "type": "string",
      "faker": "random.uuid"
    },
    "flag": {
      "type": "boolean"
    },
    "count": {
      "type": "integer",
      "minimum": 10,
      "maximum": 1000
    },
    "url": {
      "type": "string",
      "faker": "internet.url"
    },
    "version": {
      "type": "string",
      "faker": "system.semver"
    },
    "model": {
      "type": "string",
      "faker": "commerce.product"
    },
    "locale": {
      "type": "string",
      "faker": "random.locale"
    }
  }
}
```

### Document example

```javascript
{
    "_id" : ObjectId("5c4b5610084a5133fcbd058b"),
    "category" : "AAA",
    "date" : ISODate("2018-02-06T00:34:15.599Z"),
    "coordinates" : {
        "latitude" : 69,
        "longitude" : -40.8256,
        "accuracy" : 8.09294375330802
    },
    "city" : "North Liana",
    "country" : "Northern Mariana Islands",
    "state" : "New York",
    "zipCode" : "01778-6503",
    "countryCode" : "TO",
    "geojson_location" : {
        "type" : "Point",
        "coordinates" : [
            51.7532722217274,
            -49.3789013079205
        ]
    },
    "uuid" : "a815aa60-11ac-4549-85f3-9473ee6de0f5",
    "flag" : true,
    "count" : 260,
    "url" : "http://laila.name",
    "version" : "6.5.6",
    "model" : "Sausages",
    "locale" : "sv",
    "d0" : {}, // same document as root
    "d1": {}, // same document as root
    "dN": {} // same document as root
};
```

### Aggregation

#### Query example

```javascript
db.getCollection("agg_perf_test").aggregate(
  [
    {
      $match: {
        date: {
          $gte: ISODate("2018-12-25T19:24:53.304Z"),
          $lte: ISODate("2019-01-25T19:24:53.304Z")
        }
      }
    },
    { $sort: { date: -1 } },
    {
      $group: {
        _id: "$country",
        number_avg: { $avg: "$count" },
        number_max: { $max: "$count" },
        number_min: { $min: "$count" },
        date_min: { $min: "$date" },
        date_max: { $max: "$date" },
        string_last: { $last: "$city" },
        flag_true_count: { $sum: { $cond: [{ $eq: ["$flag", true] }, 1, 0] } },
        flag_false_count: { $sum: { $cond: [{ $eq: ["$flag", true] }, 0, 1] } },
        count: { $sum: 1 }
      }
    },
    { $limit: 200 }
  ],
  { allowDiskUse: true }
);
```

#### Result example

```json
[
  {
    "_id": "Namibia",
    "number_avg": 500.782152870901,
    "number_max": 1000,
    "number_min": 10,
    "date_min": ISODate("2018-01-25T19:31:14.511Z"),
    "date_max": ISODate("2019-01-25T13:19:29.199Z"),
    "string_last": "Nikolashaven",
    "flag_true_count": 4074.0,
    "flag_false_count": 4129.0,
    "count": 8203.0
  }
]
```


## Clickhouse aggregation benchmarks
Clickhouse row looks like:

```
┌─category─┬────────────────date─┬─city────────────┬─country─┬─state──┬─zipCode────┬─countryCode─┬─uuid─────────────────────────────────┬─flag─┬─count─┬─url─────────────┬─version─┬─model────┬─locale─┐
│ AAA      │ 2018-02-01 19:40:06 │ West Wyattburgh │ Tokelau │ Nevada │ 50214-1454 │ LV          │ ebf77ba4-fdc7-4b29-92f4-7963bd73f06d │    1 │   569 │ http://emma.net │ 8.8.5   │ Keyboard │ en     │
└──────────┴─────────────────────┴─────────────────┴─────────┴────────┴────────────┴─────────────┴──────────────────────────────────────┴──────┴───────┴─────────────────┴─────────┴──────────┴────────┘
```

Aggregation query:

```
select
    t1.country,
    t1.avg_count,
    t1.max_count,
    t1.min_count,
    t1.min_date,
    t1.max_date,
    t1.flag_true_count,
    t1.flag_false_count,
    t1.total_count,
    t2.city
from
    (
        select
            country,
            AVG(count) as avg_count,
            MAX(count) as max_count,
            MIN(count) as min_count,
            MIN(date) as min_date,
            MAX(date) as max_date,
            countIf(flag) as flag_true_count,
            countIf(1, flag = 0) as flag_false_count,
            SUM(count) as total_count
        from
            ${process.env.COLL_NAME}
        where
            date >= '${fromDate}'
            and date <= '${toDate}'
        group by
            country
        limit
            200
    ) t1
    left join ${process.env.COLL_NAME} t2 on t1.max_date = date
```