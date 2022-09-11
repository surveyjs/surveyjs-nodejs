// module.exports = app => {
//   const results = require("../controllers/results.controller");
//   var router = require("express").Router();


//   router.get("/:id", results.getResults);

//   router.post("/", results.postResults);

//   app.use("/api/results", router); 
// };



// //   router.get("/getActive", async (req, res) => {
// //     try {
// //         var result = await Survey.find()
// //         res.json(result);
// //     } catch (error) {
// //         res.status(500).json({message: error.message});
// //     }
// //   });
  
// //   router.get("/getSurvey", async (req, res) => {
// //     try {
// //         var surveyId = req.query["surveyId"];
// //         var result = await Survey.findById(surveyId);
// //         res.json(result);
// //     } catch (error) {
// //         res.status(500).json({message: error.message});
// //     }
// //   });
  
// //   router.get("/changeName", async (req, res) => {
// //     try {
// //         var id = req.query["id"];
// //         var name = req.query["name"];
// //         var result = await Survey.findByIdAndUpdate(
// //             id,
// //             {name: name}
// //         );
// //         res.json(result);
// //     } catch (error) {
// //         res.status(500).json({message: error.message});
// //     }
// //   });
  
// //   router.get("/create", async (req, res) => {
// //     try {
// //         var result = await Survey.create({name: 'New Survey'});
// //         res.json(result);
// //     } catch (error) {
// //         res.status(500).json({message: error.message});
// //     }
// //   });
  
// //   router.post("/changeJson", async (req, res) => {
// //     try {
// //         var id = req.body.id;
// //         var json = req.body.json;
// //         var result = await Survey.findByIdAndUpdate(
// //             id,
// //             {json: json},
// //             {new: true}
// //         );
// //         res.json(result);
// //     } catch (error) {
// //         res.status(500).json({message: error.message});
// //     }
// //   });

// //   router.get("/delete", async (req, res) => {
// //     try {
// //         var id = req.query["id"];
// //         var result = await Survey.findByIdAndDelete(id);
// //         res.json({_id: id});
// //     } catch (error) {
// //         res.status(500).json({message: error.message});
// //     }
// //   });
  
// // module.exports = router;
  