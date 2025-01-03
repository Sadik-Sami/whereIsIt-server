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
// Mongo Database Collecctions
const postCollection = client.db('lostFoundDB').collection('lostFoundPosts');
const recoveredItemsCollection = client.db('lostFoundDB').collection('recoveredItems');

// middlewares
app.use(
  cors({
    origin: ['http://localhost:5173', 'https://whereisit-tau.vercel.app'],
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

// JWT Token Login and LogOut Logics
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
    app.get('/posts', async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        if (limit < 6 || limit > 9) {
          return res.status(400).send({
            success: false,
            message: 'Items per page must be between 6 and 9',
          });
        }
        const skip = (page - 1) * limit;
        const total = await postCollection.countDocuments();
        const posts = await postCollection.find().sort({ date: -1 }).skip(skip).limit(limit).toArray();
        const totalPages = Math.ceil(total / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;

        res.send({
          success: true,
          posts,
          pagination: {
            total,
            page,
            limit,
            totalPages,
            hasNextPage,
            hasPrevPage,
          },
        });
      } catch (error) {
        console.error('Fetch posts error:', error);
        res.status(500).send({
          success: false,
          message: 'Internal server error while fetching posts',
        });
      }
    });

    // Get Specific Post
    app.get('/post/:id', verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const userEmail = req.user.email;
        const queryEmail = req.query.email;
        if (!userEmail) {
          return res.status(401).send({
            success: false,
            message: 'Unauthorized: User not authenticated',
          });
        }
        if (userEmail !== queryEmail) {
          return res.status(403).send({
            success: false,
            message: 'Forbidden Access',
          });
        }
        const post = await postCollection.findOne({ _id: new ObjectId(id) });
        res.send({ success: true, post });
      } catch (error) {
        console.error('Fetch specific post error:', error);
        res.status(500).send({
          success: false,
          message: 'Internal server error while fetching posts',
        });
      }
    });

    // Get All Posts By Logged In User
    app.get('/my-posts', verifyToken, async (req, res) => {
      try {
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
        const posts = await postCollection.find({ email: userEmail }).sort({ date: -1 }).toArray();
        res.send({
          success: true,
          posts,
        });
      } catch (error) {
        console.error('Fetch my posts error:', error);
        res.status(500).send({
          success: false,
          message: 'Internal server error while fetching posts',
        });
      }
    });

    // Get All Recovered Items By Logged In User
    app.get('/recovered-items', verifyToken, async (req, res) => {
      try {
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
            message: 'Forbidden: Token email does not match query email',
          });
        }
        const items = await recoveredItemsCollection
          .find({
            $or: [{ 'recoveredBy.email': userEmail }, { 'originalPost.email': userEmail }],
          })
          .sort({ recoveryDate: -1 })
          .toArray();
        res.send({
          success: true,
          items,
        });
      } catch (error) {
        console.error('Fetch recovered items error:', error);
        res.status(500).send({
          success: false,
          message: 'Internal server error while fetching recovered items',
        });
      }
    });

    // Recovering An Item
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

    // Creating A New Post
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
          email: userEmail, // using the email from the verified token
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

    // Updating A Post
    app.patch('/update-post/:id', verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { email } = req.query;
        const updates = req.body;
        if (req.user.email !== email) {
          return res.status(403).send({
            success: false,
            message: 'Forbidden: You can only update your own posts',
          });
        }
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
        if (!updates || Object.keys(updates).length === 0) {
          return res.status(400).send({
            success: false,
            message: 'No updates provided',
          });
        }
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
        const result = await postCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: validUpdates },
          { runValidators: true }
        );
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
        res.status(500).send({
          success: false,
          message: 'Internal server error while updating post',
        });
      }
    });

    // Deleting A Post
    app.delete('/posts/:id', verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
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
            message: 'Forbidden: Token email does not match query email',
          });
        }
        const post = await postCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!post) {
          return res.status(404).send({
            success: false,
            message: 'Post not found',
          });
        }
        if (post.email !== userEmail) {
          return res.status(403).send({
            success: false,
            message: 'Forbidden: You can only delete your own posts',
          });
        }
        const result = await postCollection.deleteOne({
          _id: new ObjectId(id),
          email: userEmail,
        });

        if (!result.deletedCount) {
          return res.status(400).send({
            success: false,
            message: 'Failed to delete post',
          });
        }
        res.send({
          success: true,
          message: 'Post deleted successfully',
        });
      } catch (error) {
        console.error('Delete post error:', error);
        if (error.name === 'CastError') {
          return res.status(400).send({
            success: false,
            message: 'Invalid post ID format',
          });
        }
        res.status(500).send({
          success: false,
          message: 'Internal server error while deleting post',
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
