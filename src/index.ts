import * as redis from 'redis';
import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import socketIO from 'socket.io';
import * as util from 'util';

const app = express();
const server = createServer(app);
const io = new Server(server);

const redisClient = redis.createClient({
    url: "redis://redis:6379"
});

const promisifiedRedisClient = {
    ...redisClient,
    ...{
        getAsync: util.promisify(redisClient.get).bind(redisClient),
        setAsync: util.promisify(redisClient.set).bind(redisClient),
        keysAsync: util.promisify(redisClient.keys).bind(redisClient),
        hgetallAsync: util.promisify(redisClient.hgetall).bind(redisClient),
        delAsync: util.promisify(redisClient.del).bind(redisClient),
    },
};

const config = {
    rooms: ["room1", "room2"],
    coinsPerRoom: 10,
    coinArea: {
        xmax: 100,
        xmin: 0,
        ymax: 100,
        ymin: 0,
        zmax: 100,
        zmin: 0,
    },
    coinTTL: 3600
};

app.get('/api/coins/:room', async (req, res) => {
    const room = req.params.room;
    try {
        const response = await getCointInRoom(room);
        res.json(response);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener la cantidad de monedas en la habitación' });
    }
});

app.get('/', (req, res) => {
    res.send('Hello World!');
})



io.on("connection", (socket) => {
    socket.on("joinRoom", async (room) => {
        socket.join(room);
        generateCoins(room); 
        socket.emit("coins", await getCointInRoom(room));
    });

    socket.on("coinPicked", async ({ room, position }) => {
        try {
                const keys = await promisifiedRedisClient.keysAsync(`coin:${room}:*`);
                const coins = await Promise.all(
                    keys.map(async (coinKey) => {
                        const coin = await promisifiedRedisClient.hgetallAsync(coinKey);
                        return coin;
                    })
                );
    
                const coinIndex = coins.findIndex((coin) =>
                    coin.x === position.x && coin.y === position.y && coin.z === position.z
                );
    
                if (coinIndex !== -1) {
                    const coinKeyToDelete = keys[coinIndex];
                    await redisClient.DEL(coinKeyToDelete);

                    coins.splice(coinIndex, 1);
                }
    
                const response = {
                    room: room,
                    coins: coins.length,
                    positions: coins.map(({ x, y, z }) => ({ x, y, z })),
                };
    
                io.to(room).emit("coins", response);
        } catch (error) {
            console.error("Error to delete coin", error);
        }
    });
});

function generateCoins(room: string) {
    for (let i = 0; i < config.coinsPerRoom; i++) {
        const x = Math.floor(
            Math.random() * (config.coinArea.xmax - config.coinArea.xmin + 1) +
            config.coinArea.xmin
        );
        const y = Math.floor(
            Math.random() * (config.coinArea.ymax - config.coinArea.ymin + 1) +
            config.coinArea.ymin
        );
        const z = Math.floor(
            Math.random() * (config.coinArea.zmax - config.coinArea.zmin + 1) +
            config.coinArea.zmin
        );

        const coin = {
            x,
            y,
            z,
            room,
        };

        const coinKey = `coin:${room}:${i}`;


        redisClient.hmset(`coin:${room}:${i}`, coin);
        
        setTimeout(() => {
            redisClient.del(coinKey, (err, reply) => {
                if (err) {
                    console.error("Error to delete coin", err);
                } else {
                    console.log(`Coins ${coinKey} deleted by 1 hour`);
                    generateCoins(room);
                 }
            });
        }, 3600000);
        
    }

}

async function getCointInRoom(room: any) {
    const dataFromRedis = await promisifiedRedisClient.keysAsync(`coin:${room}:*`);

    const coins = await Promise.all(
        dataFromRedis.map(async (coinKey: any) => {
            const coin = await promisifiedRedisClient.hgetallAsync(coinKey);
            return coin;
        })
    );

    const response = {
        room: room,
        coins: coins.length,
        positions: coins.map(({ x, y, z }: any) => ({ x, y, z })),
    };

    return response;

}

const port = 6000;
server.listen(port, () => {
    console.log(`Servera running on port ${port}`);
})


