import { MongoClient, Db } from 'mongodb';

// 定義資料介面
interface YouBikeStation {
    station_no: string;
    name_tw: string;
    district_tw: string;
    address_tw: string;
    lat: number;
    lng: number;
    parking_spaces: number;
    available_spaces: number;
    empty_spaces: number;
    act: string;
    update_time: string;
    fetched_at?: Date;
}

// 設定與環境變數
// 預設值改為 Zeabur 內網格式 (方便本地測試時知道格式，但主要靠環境變數覆寫)
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://mongo:cc@mongodb.zeabur.internal:27017/youbike-log-hualien?authSource=admin";
// 資料庫名稱改為你指定的
const DB_NAME = "youbike-log-hualien";
const COLLECTION_NAME = "parking_info";

let cachedDb: Db | null = null;

async function connectToDatabase(): Promise<Db> {
    if (cachedDb) {
        return cachedDb;
    }

    // 設定連線選項
    const client = new MongoClient(MONGODB_URI);

    await client.connect();
    console.log("🔌 Connected to MongoDB");

    // 這裡會優先使用 URI 裡指定的 DB，如果沒有則使用常數
    cachedDb = client.db(DB_NAME);
    return cachedDb;
}

export const handler = async () => {
    try {
        console.log("🚀 Starting YouBike fetch job...");

        const response = await fetch("https://apis.youbike.com.tw/tw2/parkingInfo", {
            method: "POST",
            headers: {
                "accept": "*/*",
                "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "content-type": "application/json",
                "referrer": "https://www.youbike.com.tw/",
                "origin": "https://www.youbike.com.tw"
            },
            body: JSON.stringify({
                "lat": 23.66483258393811,
                "lng": 121.42314095239257,
                "maxDistance": 5000
            })
        });

        if (!response.ok) {
            throw new Error(`API responded with status: ${response.status}`);
        }

        const data = await response.json() as YouBikeStation[];

        if (data.length === 0) {
            console.log("⚠️ No stations found.");
            return;
        }

        const fetchTime = new Date();
        const documentsToSave = data.map(station => ({
            ...station,
            fetched_at: fetchTime
        }));

        const db = await connectToDatabase();
        const collection = db.collection(COLLECTION_NAME);

        const operations = documentsToSave.map(doc => ({
            updateOne: {
                filter: { station_no: doc.station_no },
                update: { $set: doc },
                upsert: true
            }
        }));

        const result = await collection.bulkWrite(operations);
        console.log(`💾 [${fetchTime.toISOString()}] Updated: ${result.modifiedCount}, Upserted: ${result.upsertedCount}, Matched: ${result.matchedCount}`);

    } catch (error) {
        console.error("❌ Error:", error);
    }
};

// 讓 Docker 容器執行時能跑這段
if (require.main === module) {
    handler()
        .then(() => console.log("✅ Job cycle finished"))
        .catch((err) => console.error("🔥 Job cycle failed", err))
        .finally(() => process.exit(0));
}