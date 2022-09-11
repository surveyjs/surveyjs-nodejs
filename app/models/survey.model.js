const { Schema } = require("mongoose");

module.exports = mongoose => {

    var surveySchema = mongoose.Schema(
        {
            postId: String,
            name: {type: String, default: "New Survey"},
            json: Object
    },
     { timestamps: true, toJSON: {virtuals: true}, toObject: {virtuals: true} }
    );

    surveySchema.virtual('data', {ref: 'Result', localField: 'postId', foreignField: 'postId'});

    surveySchema.method("toJSON", function() {
        const { __v, _id, ...object } = this.toObject();
        object._id = _id;
        return object;
      });

    const Survey = mongoose.model("Survey", surveySchema);
    return Survey;
};