import { MongoClient, Db, CollectionAggregationOptions } from "mongodb";

export const getMongogoDbConnection = async (): Promise<Db> => {
    const client = await MongoClient.connect(
      process.env.DB_URI || "mongodb://localhost:27017",
      { connectTimeoutMS: 700000, socketTimeoutMS: 700000, useNewUrlParser: true }
    );
    return await client.db(process.env.DB_NAME);
  };