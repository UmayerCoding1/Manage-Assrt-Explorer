const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");

require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;

// {
//   origin: ['http://localhost:5173'],
//   methods: ['GET', 'POST', 'PUT', 'DELETE'], // Adjust methods as needed
//   credentials: true,
//   allowedHeaders: ['Content-Type', 'Authorization']
// }
// middleware
app.use(cors({
  origin: [
    
    'http://localhost:5173',
    'https://mae-auth.web.app/'

  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Adjust methods as needed
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Manage asset explorer (MAE) sever is  ready ");
});

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.34gmw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const userCollection = client.db("MAE").collection("users");
    const hrCollection = client.db("MAE").collection("hr");
    const employeeCollection = client.db("MAE").collection("employee");
    const assetsCollection = client.db("MAE").collection("assets");
    const assetRequestCollection = client.db("MAE").collection("em_Asset_Request");
    const assetReturnedCollection = client.db("MAE").collection("asset_returned");

    // jwt related api

    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "5h",
      });

      res.send({ token });
    });
    // verifyToken
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      const token = req.headers.authorization;

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decode) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }

        req.decode = decode;
        next();
      });
    };

    //  verifyHr
    const verifyHr = async (req, res, next) => {
      const email = req.decode.email;
      const query = { email: email };
      const user = await hrCollection.findOne(query);
      const isHr = user?.role === "hr";
      if (!isHr) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // user api
    app.get("/users", async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    // gwt employee role
    app.get("/em-role", async (req, res) => {
      const query = req.query.email;

      const result = await employeeCollection.find({ email: query }).toArray();
      res.send(result);
    });

    // get hr role
    app.get("/hr-role", async (req, res) => {
      const query = req.query.email;
    //  console.log(query);
     
      const result = await hrCollection.find({ email: query }).toArray();
      res.send(result);
    });

    app.post("/register-hr", async (req, res) => {
      const { name, email, password, dob, companyName, logo, memberPackage } =
        req.body;

      const hr = {
        name,
        email,
        password,
        dob,
        companyName,
        logo,
        memberPackage,
        role: "hr",
      };
      const userHr = {
        name,
        email,
        companyName,
        memberPackage,
        role: "hr",
      };

      const queryUser = { email: email };
      const user = await userCollection.findOne(queryUser);
      if (user) {
        return res.send({ message: "user already exists", insertId: null });
      }
      const queryHr = { email: email };
      const existHr = await hrCollection.findOne(queryHr);
      if (existHr) {
        return res.send({ message: "hr already exists", insertId: null });
      }

      const result = await userCollection.insertOne(userHr);
      const hrResult = await hrCollection.insertOne(hr);
      res.send(hrResult);
    });

    //update hr data  after payment
    app.patch("/register-hr", async (req, res) => {
      const { paymentStatus, transactionId, hrId } = req.body;
      const filter = { _id: new ObjectId(hrId) };
      const updatedDoc = {
        $set: {
          paymentStatus: paymentStatus || "",
          transactionId: transactionId,
        },
      };

      const result = await userCollection.updateOne(filter, updatedDoc);
      const hrResult = await hrCollection.updateOne(filter, updatedDoc);
      res.send(hrResult);
    });

    // add a asset
    app.get("/assets", verifyToken, async (req, res) => {
      const query = req.query;

      const filter = {
        ...(query._id && {
          hrId: query._id,
        }),
        ...(query.search && {
          productName: { $regex: query.search, $options: "i" },
        }),
        ...(query.type &&
          query.type.trim() !== "" && {
            category: query.type,
          }),
      };

      const result = await assetsCollection.find(filter).toArray();

      res.send(result);
    });

    app.get("/assets/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await assetsCollection.findOne(query);
      res.send(result);
    });

    app.post("/add-asset", verifyToken, verifyHr, async (req, res) => {
      const asset = req.body;
      console.log(asset || 'as');
      
      const existingAsset = await assetsCollection.findOne({
        productName: asset.productName,
      });
      console.log(existingAsset || 'ex');
      

      if (existingAsset && asset?.hrId === existingAsset?.hrId) {
        // update already existing asset quantity
        const result = await assetsCollection.updateOne(
          { productName: asset.productName },
          { $inc: { quantity: asset.quantity } }
        );

        if (result.modifiedCount > 0) {
          console.log("asset quantity updated", asset.hrId);
          res.send("asset quantity updated",);
        } else {
          console.log("not update made to a new asset");
        }
      } else {
        const result = await assetsCollection.insertOne(asset);
        res.send(result);
      }
    });

    // delete a asset
    app.delete("/assets/:id", verifyToken, verifyHr, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await assetsCollection.deleteOne(query);
      res.send(result);
    });

    // update an asset
    app.put("/assets/:id", async (req, res) => {
      const { updateQuantity } = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          quantity: updateQuantity,
        },
      };

      const result = await assetsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // asset request

    app.get("/asset-request", verifyToken, async (req, res) => {
      const query = req.query;

      const filter = {
        ...(query?.email && {
          emEmail: query.email,
        }),
        ...(query.type &&
          query.type.trim() !== "" && {
            category: query.type,
          }),
        ...(query.search &&
          query?.search !== "" && {
            productName: { $regex: query.search, $options: "i" },
          }),
        ...(query?.hrId && {
          hrId: query?.hrId,
        }),
        ...(query?.assetsStatus &&
          query.assetsStatus !== "" && {
            status: query.assetsStatus,
          }),
      };
      const result = await assetRequestCollection.find(filter).toArray();
      res.send(result);
    });

    app.post("/asset-request", async (req, res) => {
      const request = req.body;

      const queryProductId = { productId: request.productId };
      const prevAsset = await assetRequestCollection.findOne(queryProductId);

      if (request.email === prevAsset?.email && prevAsset) {
        return res.status(405).send({ message: "This Request  Not Allowed" });
      }

      const result = await assetRequestCollection.insertOne(request);
      res.send(result);
    });

    app.patch("/asset-request/:id", async (req, res) => {
      const { requestQuantity } = req.body;
      const id = req.params.id;
      const { productId } = req.query;
      const filter = { _id: new ObjectId(id) };
      const findAsset = { _id: new ObjectId(productId) };
      const asset = await assetsCollection.findOne(findAsset);
      

      const updateDoc = {
        $set: {
          status: "approved",
          approved_Date: new Date().toISOString().split("T")[0],
        },
      };

      if (asset.quantity && asset.quantity > 0) {
        const updatedAssetDoc = {
          $inc: { quantity: -requestQuantity },
        };
        const updateAsset = await assetsCollection.updateOne(
          findAsset,
          updatedAssetDoc
        );
      }

      const result = await assetRequestCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.put("/asset-request/:id", async(req,res) => {
      const id = req.params.id;
      const {productId} = req.query;
      const filter = {_id: new ObjectId(id)};
      const findAsset = {_id: new ObjectId(productId)};
      const asset = await assetsCollection.findOne(findAsset);
      const filterAsset = await assetRequestCollection.findOne(filter);
     console.log('ap');
     
      const updateDov = {
        $set: {
          status: 'returned ',
        }
      };

      if(asset.quantity){
        const updateAssetDoc = {
          $inc: {quantity: +1},
        };
        const updateAsset  = await assetsCollection.updateOne(findAsset, updateAssetDoc);
        const assetReturned = await assetReturnedCollection.insertOne(filterAsset);
      }

      const result = await assetRequestCollection.updateOne(filter, updateDov);
      const assetDelete = await assetRequestCollection.deleteOne(filter);
      res.send(result);
      

    })

    //  employee api
    // get all employee data
    app.get("/employee", verifyToken, verifyHr, async (req, res) => {
      // const l =await employeeCollection.estimatedDocumentCount();
     const {hrId} = req.query;
     
     
      const result = await employeeCollection.find({hrId: hrId}).toArray();
      // console.log(result);
      
      res.send(result);
    });

    // create a employee
    app.post("/add-employee", verifyToken, verifyHr, async (req, res) => {
      const {
        name,
        email,
        password,
        dob,
        companyName,
        emCategory,
        emImage,
        emDetails,
        hrId,
        companyLogo,
        joinDate,
        memberPackage,
      } = req.body;
      const packageLength = parseInt(memberPackage);
      const emUser = {
        name,
        email,
        dob,
        role: "employee",
        hrId,
        joinDate,
        emCategory,
        companyName,
      };
      const em = {
        name,
        email,
        password,
        dob,
        companyName,
        emCategory,
        emImage,
        emDetails,
        hrId,
        companyLogo,
        joinDate,
        role: "employee",
      };

      const queryUser = { email: email };
      const user = await userCollection.findOne(queryUser);
      if (user) {
        return res.send({ message: "user already exists", insertId: null });
      }
      const queryEm = { email: email };
      const existEm = await hrCollection.findOne(queryEm);
      if (existEm) {
        return res.send({ message: "employee already exists", insertId: null });
      }

      const packageLimit = await employeeCollection.estimatedDocumentCount();
      if (packageLimit >= packageLength) {
        return res.status(404).send({
          message:
            "Sorry hr your employee added limit is close(Please more package)",
          insertedId: null,
        });
      }

      const result = await userCollection.insertOne(emUser);
      const emResult = await employeeCollection.insertOne(em);
      res.send(emResult);
    });

    // hr payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const { memberPackage } = req.body;
      const amount = parseInt(memberPackage * 100);

      // create a paymentIntent with the select package amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`This Manage asset explorer (MAE) server running PORT:${port}`);
});
