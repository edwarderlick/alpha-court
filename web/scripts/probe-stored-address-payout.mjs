import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
const KEY=(readFileSync(join(process.cwd(),".env.local"),"utf8").match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m)||[])[1].trim();
const RECIPIENT="0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253";
const FUND=10n**16n, PAY=7n*10n**15n;
const OUT=join(process.cwd(),"_verify","payout-audit"); mkdirSync(OUT,{recursive:true});
const code=readFileSync(join(process.cwd(),"..","contract","contracts","settle_probe.py"),"utf8");
const client=createClient({chain:chains.studionet,account:createAccount(KEY)});
const wait=h=>client.waitForTransactionReceipt({hash:h,retries:150,interval:4000});
const exec=r=>String(r?.consensus_data?.leader_receipt?.[0]?.execution_result??r?.execution_result??"?").toUpperCase();
const before=await client.getBalance({address:RECIPIENT});
const dh=await client.deployContract({code,args:[]}); const dr=await wait(dh);
const addr=dr.data?.contract_address||dr.contract_address||dr.to_address;
console.log("deploy",exec(dr),addr);
if(exec(dr)!=="SUCCESS"){console.log(JSON.stringify(dr.consensus_data?.leader_receipt?.[0]?.result));process.exit(2);}
for(const [fn,args,val] of [["fund",[],FUND],["remember",[RECIPIENT],undefined]]){
  const h=await client.writeContract({address:addr,functionName:fn,args,...(val?{value:val}:{})});
  const r=await wait(h); console.log(fn,exec(r),h);
  if(exec(r)!=="SUCCESS"){console.log(r.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr?.slice(-500));process.exit(3);}
}
const ph=await client.writeContract({address:addr,functionName:"pay_stored",args:[PAY.toString()]});
const pr=await wait(ph); const pExec=exec(pr);
console.log("pay_stored",pExec,ph);
if(pExec!=="SUCCESS") console.log(pr.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr?.slice(-600));
let trig=pr.triggered_transactions||pr.data?.triggered_transactions||[];
for(let i=0;i<20&&(!trig||trig.length===0);i++){await new Promise(r=>setTimeout(r,4000));const a=await client.getTransaction({hash:ph});trig=a.triggered_transactions||a.data?.triggered_transactions||[];}
let child=null;
if(trig?.length){for(let i=0;i<20;i++){child=await client.getTransaction({hash:trig[0]});if(child.value_credited!==undefined&&child.value_credited!==null)break;await new Promise(r=>setTimeout(r,4000));}}
let after=await client.getBalance({address:RECIPIENT});
for(let i=0;i<25&&after<=before;i++){await new Promise(r=>setTimeout(r,5000));after=await client.getBalance({address:RECIPIENT});}
const ev={kind:"stored_address_payout_probe",shape:"recipient Address read back from contract storage (production _pay_native shape)",
 probe:addr,payHash:ph,payExec:pExec,triggered:trig,
 child:child?{hash:child.hash,to:child.to_address||child.to,value:String(child.value),value_credited:child.value_credited}:null,
 balances:{before:before.toString(),after:after.toString(),delta:(after-before).toString(),credited:after>before}};
writeFileSync(join(OUT,"stored-address-probe.json"),JSON.stringify(ev,null,2));
console.log(JSON.stringify(ev,null,2));
if(!ev.balances.credited)process.exit(4);
