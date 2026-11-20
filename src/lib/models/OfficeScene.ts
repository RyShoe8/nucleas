import mongoose,{Schema} from 'mongoose';
import type {OfficeScene as Scene} from '@/lib/office/timeline';
interface OfficeDocument { _id:mongoose.Types.ObjectId;revision:number;scene:Scene }
// One authoritative scene per organization, independent of who opens a window.
const schema=new Schema<OfficeDocument>({
  _id:{type:Schema.Types.ObjectId,required:true},
  revision:{type:Number,required:true,default:0},
  scene:{type:Schema.Types.Mixed,required:true},
},{minimize:false});
export const OfficeSceneModel=(mongoose.models.OfficeScene as mongoose.Model<OfficeDocument>|undefined)??mongoose.model<OfficeDocument>('OfficeScene',schema);
