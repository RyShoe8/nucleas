import mongoose,{Schema,type InferSchemaType,type Model} from 'mongoose';

// Binary storage only. Asset remains the canonical file; listing assets never loads animation bytes.
const schema=new Schema({
  assetId:{type:Schema.Types.ObjectId,ref:'Asset',required:true,unique:true},
  organizationId:{type:Schema.Types.ObjectId,required:true},
  companyId:{type:Schema.Types.ObjectId,ref:'Client',required:true},
  bytes:{type:Buffer}, // Existing Mongo sources remain readable.
  storage:{type:String,enum:['mongo','rogly'],default:'mongo'},
  objectKey:String,
  byteLength:Number,
  sha256:String,
},{timestamps:true});
schema.index({organizationId:1,companyId:1,assetId:1});
type Payload=InferSchemaType<typeof schema>;
export const AnimationPayload:Model<Payload>=(mongoose.models.AnimationPayload as Model<Payload>|undefined)??mongoose.model<Payload>('AnimationPayload',schema);
