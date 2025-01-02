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
const recoveredItemsCollection = client.db('lostFoundDB').collection('recoveredItems');

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
    // recover Item
    app.post('/recover-item', verifyToken, async (req, res) => {
      const recoveryData = req.body;
      if (req.user.email !== req.query.email) {
        return res.status(403).send({
          success: false,
          message: 'Forbidden: You can only update your own posts',
        });
      }
      try {
        const recoveryResult = await recoveredItemsCollection.insertOne(recoveryData);
        const updateResult = await postCollection.updateOne(
          { _id: new ObjectId(recoveryData.postId) },
          { $set: { status: 'recovered' } }
        );

        if (!recoveryResult.acknowledged || !updateResult.acknowledged) {
          return res.status(400).send({ success: false, message: 'Failed to process recovery' });
        }

        res.send({ success: true, message: 'Item marked as recovered successfully' });
      } catch (error) {
        res.status(500).send({ success: false, message: 'Internal server error' });
      }
    });
    // create a post
    app.post('/posts', verifyToken, async (req, res) => {
      try {
        const postData = req.body;
        const userEmail = req.user.email;
        const queryEmail = req.query.email;
        if (!userEmail) {
          return res.status(401).send({
            success: false,
            message: 'Unauthorized: User not authenticated',
          });
        }
        if (queryEmail && userEmail !== queryEmail) {
          return res.status(403).send({
            success: false,
            message: 'Forbidden Access',
          });
        }
        if (postData.email && userEmail !== postData.email) {
          return res.status(403).send({
            success: false,
            message: 'Forbidden Action',
          });
        }
        const requiredFields = ['title', 'description', 'location', 'category', 'thumbnail', 'postType'];
        const missingFields = requiredFields.filter((field) => !postData[field]);

        if (missingFields.length > 0) {
          return res.status(400).send({
            success: false,
            message: `Missing required fields: ${missingFields.join(', ')}`,
          });
        }
        if (!['Lost', 'Found'].includes(postData.postType)) {
          return res.status(400).send({
            success: false,
            message: 'Invalid post type. Must be either "Lost" or "Found"',
          });
        }
        const sanitizedPost = {
          title: postData.title.trim(),
          description: postData.description.trim(),
          location: postData.location.trim(),
          category: postData.category.toLowerCase(),
          thumbnail: postData.thumbnail,
          postType: postData.postType,
          date: new Date(postData.date),
          status: null,
          email: userEmail, // Always use the email from the verified token
          name: postData.name,
          createdAt: new Date(),
        };
        const result = await postCollection.insertOne(sanitizedPost);

        if (!result.insertedId) {
          throw new Error('Failed to create post');
        }
        const createdPost = await postCollection.findOne({
          _id: result.insertedId,
        });
        res.status(201).send({
          success: true,
          message: 'Post created successfully',
          post: createdPost,
        });
      } catch (error) {
        console.error('Create post error:', error);
        if (error.name === 'ValidationError') {
          return res.status(400).send({
            success: false,
            message: 'Invalid data provided',
            errors: Object.values(error.errors).map((err) => err.message),
          });
        }
        res.status(500).send({
          success: false,
          message: 'Internal server error while creating post',
        });
      }
    });
    // Update Post
    app.patch('/update-post/:id', verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { email } = req.query;
        const updates = req.body;

        // Authorization check
        if (req.user.email !== email) {
          return res.status(403).send({
            success: false,
            message: 'Forbidden: You can only update your own posts',
          });
        }

        // Validate post existence and ownership
        const existingPost = await postCollection.findOne({
          _id: new ObjectId(id),
          email: email,
        });

        if (!existingPost) {
          return res.status(404).send({
            success: false,
            message: 'Post not found or you do not have permission to update it',
          });
        }

        // Validate updates
        if (!updates || Object.keys(updates).length === 0) {
          return res.status(400).send({
            success: false,
            message: 'No updates provided',
          });
        }

        // validate the updates (not letting the user update immutable fields)
        const allowedUpdates = ['title', 'description', 'location', 'category', 'thumbnail', 'date', 'postType'];

        const validUpdates = Object.keys(updates)
          .filter((key) => allowedUpdates.includes(key))
          .reduce((obj, key) => {
            obj[key] = updates[key];
            return obj;
          }, {});

        if (Object.keys(validUpdates).length === 0) {
          return res.status(400).send({
            success: false,
            message: 'No valid updates provided',
          });
        }

        // Validating required fields if they're being updated
        if (validUpdates.title && !validUpdates.title.trim()) {
          return res.status(400).send({
            success: false,
            message: 'Title cannot be empty',
          });
        }

        if (validUpdates.description && !validUpdates.description.trim()) {
          return res.status(400).send({
            success: false,
            message: 'Description cannot be empty',
          });
        }

        // the actual update operation
        const result = await postCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: validUpdates },
          { runValidators: true }
        );

        // checking update result
        if (!result.matchedCount) {
          return res.status(404).send({
            success: false,
            message: 'Post not found',
          });
        }

        if (!result.modifiedCount) {
          return res.status(400).send({
            success: false,
            message: 'No changes made to the post',
          });
        }

        // sending the new updated post
        const updatedPost = await postCollection.findOne({
          _id: new ObjectId(id),
        });

        res.send({
          success: true,
          message: 'Post updated successfully',
          post: updatedPost,
        });
      } catch (error) {
        console.error('Update post error:', error);

        //mongoDB error handling
        if (error.name === 'ValidationError') {
          return res.status(400).send({
            success: false,
            message: 'Invalid data provided',
            errors: Object.values(error.errors).map((err) => err.message),
          });
        }

        if (error.name === 'CastError') {
          return res.status(400).send({
            success: false,
            message: 'Invalid ID format',
          });
        }

        // normal/ general error cases
        res.status(500).send({
          success: false,
          message: 'Internal server error while updating post',
        });
      }
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});
