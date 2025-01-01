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
app.post('/login', async (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '6h' });
  res
    .cookie('token', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    })
    .send({ success: true });
});
app.post('/logout', (req, res) => {
  res
    .clearCookie('token', {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    })
    .send({ success: true });
});
async function run() {
  try {
    await client.connect();
    // get all posts
    app.get('/posts', async (req, res) => {
      const posts = await postCollection.find({}).sort({ date: -1 }).toArray();
      res.send({ success: true, posts });
    });
    // get specific post
    app.get('/post/:id', async (req, res) => {
      const id = req.params.id;
      const post = await postCollection.findOne({ _id: new ObjectId(id) });
      res.send({ success: true, post });
    });
    // post a post
    app.post('/add-post', async (req, res) => {
      const postData = req.body;
      const response = await postCollection.insertOne(postData);
      if (!result.acknowledged) {
        return res.send({ success: false, message: 'Failed to add post' });
      }
      res.send({ success: true, message: 'Post added successfully' });
    });
    // update a post
    app.patch('/update-post/:id', verifyToken, async (req, res) => {
      const { id } = req.params;
      const { email } = req.query;
      const updates = req.body;
      if (req.user.email !== email) {
        return res.status(403).send({ success: false, message: 'Forbidden Access' });
      }
      res.send({ success: true, updates });
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});
