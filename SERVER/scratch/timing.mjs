const base="http://localhost:3000/api/v1";
const t0=Date.now();
const login=await (await fetch(`${base}/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:"9876500000",password:"Owner@123"})})).json();
const token=login.data?.token; const H={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
console.log("login:", Date.now()-t0, "ms");
for(const ep of ["/owner/products?page=1&limit=20&sortBy=newest","/owner/products/stats","/customers?page=1&limit=20&sortOrder=desc"]){
  const s=Date.now(); const r=await fetch(`${base}${ep}`,{headers:H}); console.log(r.status, ep.split("?")[0], Date.now()-s, "ms");
}
