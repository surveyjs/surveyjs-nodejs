const { Schema } = require("mongoose");

module.exports = mongoose => {

    var resultSchema = mongoose.Schema(
        {
            postId: String,
            data: Schema.Types.Mixed
        }
    );


      resultSchema.method("toJSON", function() {
        const { __v, _id, ...object } = this.toObject();
        object.id = _id;
        return object;
      });
    const Result = mongoose.model("Result", resultSchema);
    return Result;
};