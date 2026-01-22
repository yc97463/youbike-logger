import { MongoClient, Db } from 'mongodb';

// 定義 YouBike 站點資料介面
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

// MongoDB 設定
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://mongo:cc@mongodb.zeabur.internal:27017/youbike-log-hualien?authSource=admin";
const DB_NAME = "youbike-log-hualien";
const COLLECTION_NAME = "parking_info";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

async function connectToDatabase(): Promise<Db> {
    if (cachedDb) {
        return cachedDb;
    }
    cachedClient = new MongoClient(MONGODB_URI);
    await cachedClient.connect();
    console.log("🔌 Connected to MongoDB");
    cachedDb = cachedClient.db(DB_NAME);
    return cachedDb;
}

async function closeDatabase() {
    if (cachedClient) {
        await cachedClient.close();
        console.log("🔌 Closed MongoDB connection");
        cachedClient = null;
        cachedDb = null;
    }
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

        // 1. 先將回傳結果視為 unknown，再進行檢查
        const rawData = await response.json() as any;

        // 2. 嘗試找出真正的陣列資料 (YouBike API 通常包在 retVal 或 data 裡)
        let stationList: YouBikeStation[] = [];

        if (Array.isArray(rawData)) {
            stationList = rawData;
        } else if (Array.isArray(rawData.retVal)) {
            stationList = rawData.retVal; // 常見格式 1
        } else if (Array.isArray(rawData.data)) {
            stationList = rawData.data;   // 常見格式 2
        } else {
            // 3. 如果都找不到，拋出錯誤並印出結構以便除錯
            console.error("🔍 Unexpected API Response Structure:", JSON.stringify(rawData).substring(0, 200) + "...");
            throw new Error("Could not find station array in response");
        }

        console.log(`📡 Fetched ${stationList.length} stations.`);

        if (stationList.length === 0) {
            console.log("⚠️ No stations found in range.");
            return;
        }

        // 4. 資料處理
        const fetchTime = new Date();
        const documentsToSave = stationList.map(station => ({
            ...station,
            fetched_at: fetchTime
        }));

        // 5. 寫入資料庫
        const db = await connectToDatabase();
        const collection = db.collection(COLLECTION_NAME);

        // 改為直接插入新紀錄 (Log 模式)，而非更新舊紀錄
        const result = await collection.insertMany(documentsToSave);
        console.log(`💾 [${fetchTime.toISOString()}] Success! Inserted: ${result.insertedCount} documents.`);

    } catch (error) {
        // 這裡我們將錯誤往上拋，讓外層的 loop 知道這次失敗了
        console.error("❌ Job Error:", error);
        throw error;
    }
};

// Docker 進入點
if (require.main === module) {
    handler()
        .then(async () => {
            console.log("✅ Job cycle finished");
            await closeDatabase();
        })
        .catch(async (err) => {
            // 這裡只印簡單訊息，詳細錯誤在 handler 內已經印過了
            console.error("🔥 Job cycle failed");
            await closeDatabase();
            // 注意：這裡不執行 process.exit(1)，以免 Docker 容器整個掛掉重啟，
            // 我們讓它自然結束，等待下一次 loop (由 Dockerfile 中的 while loop 控制)
        });
}