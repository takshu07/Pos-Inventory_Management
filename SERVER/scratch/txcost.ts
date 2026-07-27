import "dotenv/config";
import { prisma } from "../src/config/prisma";
async function main(){
  await prisma.product.count(); // warm
  for(let i=0;i<3;i++){
    let s=Date.now(); await prisma.product.count(); console.log("plain count:", Date.now()-s,"ms");
    s=Date.now(); await Promise.all([prisma.product.count(), prisma.product.findMany({take:20,include:{variants:true,category:true,brand:true}})]); console.log("Promise.all count+findMany:", Date.now()-s,"ms");
    s=Date.now(); await prisma.$transaction([prisma.product.count(), prisma.product.findMany({take:20,include:{variants:true,category:true,brand:true}})]); console.log("$transaction count+findMany:", Date.now()-s,"ms");
  }
}
main().then(()=>prisma.$disconnect());
