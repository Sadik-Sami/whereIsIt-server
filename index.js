require('dotenv').config();
const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const port = process.env.PORT || 5000;
const app = express();
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.3b45u.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Mongo Client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
// Mongo Databases
const postCollection = client.db('lostFoundDB').collection('lostFoundPosts');

// middlewares
app.use(
  cors({
    origin: ['http://localhost:5173', 'https://job-hunt-8be6b.web.app', 'https://job-hunt-8be6b.firebaseapp.com'],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// Custom Middlewear
const verifyToken = (req, res, next) => {
  const token = req?.cookies?.token;
  if (!token) {
    return res.status(401).send({ success: false, message: 'Unauthorized access' });
  }
  jwt.verify(token, process.env.JWT_SECRET, (error, decoded) => {
    if (error) {
      return res.status(401).send({ success: false, message: 'Unauthorized access' });
    }
    req.user = decoded;
    next();
  });
};

app.get('/', (req, res) => {
  res.send('Looking for lost items');
});

async function run() {
  try {
    await client.connect();
    // get all posts
    app.get('/posts', async (req, res) => {
      // const posts = await postCollection.find({}).toArray();
      const posts = await postCollection.find({}).sort({ 'date': -1 }).toArray();
      res.send({ success: true, posts });
    });
    // get specific post
    app.get('/post/:id', async (req, res) => {
      const id = req.params.id;
      const post = await postCollection.findOne({ _id: new ObjectId(id) });
      res.send({ success: true, post });
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});
