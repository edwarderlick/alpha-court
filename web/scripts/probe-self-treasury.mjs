import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
const KEY=(readFileSync(join(process.cwd(),".env.local"),"utf8").match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m)||[])[1].trim();
const RECIPIENT="0x7E4E1f7DcC3DA063F9110477Ad348C90E8599253";
const DEPOSIT=12n*10n**15n, PAY=8n*10n**15n;
const OUT=join(process.cwd(),"_verify","payout-audit"); mkdirSync(OUT,{recursive:true});
const code=readFileSync(join(process.cwd(),"..","contract","contracts","self_treasury_probe.py"),"utf8");
const account=createAccount(KEY);
const client=createClient({chain:chains.studionet,account});
const wait=h=>client.waitForTransactionReceipt({hash:h,retries:150,interval:4000});
const exec=r=>String(r?.consensus_data?.leader_receipt?.[0]?.execution_result??r?.execution_result??"?").toUpperCase();

const dh=await client.deployContract({code,args:[]}); const dr=await wait(dh);
const addr=dr.data?.contract_address||dr.contract_address||dr.to_address;
console.log("deploy",exec(dr),addr);
if(exec(dr)!=="SUCCESS"){console.log(JSON.stringify(dr.consensus_data?.leader_receipt?.[0]?.result));process.exit(2);}

const balBefore=await client.readContract({address:addr,functionName:"balance_now",args:[]});
console.log("self.balance before deposit:",balBefore);

// PLAIN native transfer to the contract address. No calldata, no method call.
const depHash=await client.sendTransaction({to:addr,value:DEPOSIT,account});
console.log("plain deposit tx",depHash);
const depR=await wait(depHash);
console.log("deposit status",depR.status,"exec",exec(depR));

let balAfter=await client.readContract({address:addr,functionName:"balance_now",args:[]});
for(let i=0;i<20&&BigInt(balAfter)===BigInt(balBefore);i++){await new Promise(r=>setTimeout(r,5000));balAfter=await client.readContract({address:addr,functionName:"balance_now",args:[]});}
const chainBal=await client.getBalance({address:addr});
console.log("self.balance after :",balAfter," eth_getBalance:",chainBal.toString());

const credited=BigInt(balAfter)-BigInt(balBefore);
let payExec="SKIPPED", child=null, recBefore=0n, recAfter=0n, trig=[];
if(credited>0n){
  recBefore=await client.getBalance({address:RECIPIENT});
  const ph=await client.writeContract({address:addr,functionName:"pay",args:[RECIPIENT,PAY.toString()]});
  const pr=await wait(ph); payExec=exec(pr);
  console.log("pay",payExec,ph);
  if(payExec!=="SUCCESS") console.log("stderr:",pr.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr?.slice(-500));
  trig=pr.triggered_transactions||pr.data?.triggered_transactions||[];
  for(let i=0;i<20&&(!trig||trig.length===0);i++){await new Promise(r=>setTimeout(r,4000));const a=await client.getTransaction({hash:ph});trig=a.triggered_transactions||a.data?.triggered_transactions||[];}
  if(trig?.length){for(let i=0;i<20;i++){child=await client.getTransaction({hash:trig[0]});if(child.value_credited!=null)break;await new Promise(r=>setTimeout(r,4000));}}
  recAfter=await client.getBalance({address:RECIPIENT});
  for(let i=0;i<20&&recAfter<=recBefore;i++){await new Promise(r=>setTimeout(r,5000));recAfter=await client.getBalance({address:RECIPIENT});}
}
const ev={kind:"self_treasury_probe",question:"does a plain native send to a contract address credit spendable self.balance with no __receive__?",
 probe:addr,depositTx:depHash,depositAtto:DEPOSIT.toString(),
 selfBalanceBefore:balBefore,selfBalanceAfter:balAfter,creditedAtto:credited.toString(),
 ethGetBalance:chainBal.toString(),
 payExec,triggered:trig,
 child:child?{hash:child.hash,to:child.to_address||child.to,value:String(child.value),value_credited:child.value_credited}:null,
 recipientDelta:(recAfter-recBefore).toString(),
 DEPOSIT_CREDITED:credited>0n, PAYOUT_WORKED:(recAfter-recBefore)>0n};
writeFileSync(join(OUT,"self-treasury-probe.json"),JSON.stringify(ev,null,2));
console.log(JSON.stringify(ev,null,2));
