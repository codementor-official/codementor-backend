import { SESv2Client, GetAccountCommand, GetEmailIdentityCommand, SendEmailCommand } from '@aws-sdk/client-sesv2';
const client = new SESv2Client({ region: process.env.AWS_REGION ?? 'ap-southeast-1', maxAttempts: 1 });
for (const [label, command] of [
 ['account', new GetAccountCommand({})],
 ['identity', new GetEmailIdentityCommand({ EmailIdentity: 'codementor.cloud' })],
]) {
 try {
   const r = await client.send(command);
   console.log(label, JSON.stringify(label==='account' ? {
     sendingEnabled:r.SendingEnabled, productionAccess:r.ProductionAccessEnabled, quota:r.SendQuota
   } : { verified:r.VerifiedForSendingStatus, status:r.VerificationStatus, dkim:r.DkimAttributes?.Status }));
 } catch (e) { console.log(label, JSON.stringify({ error:e.name, status:e.$metadata?.httpStatusCode })); }
}
if (process.argv.includes('--send-simulator')) {
 try {
   const r=await client.send(new SendEmailCommand({
     FromEmailAddress:process.env.SES_FROM_EMAIL ?? 'noreply@codementor.cloud',
     Destination:{ToAddresses:['success@simulator.amazonses.com']},
     Content:{Simple:{Subject:{Data:'CodeMentor SES transport verification',Charset:'UTF-8'},
       Body:{Text:{Data:'Synthetic transport test. No user data.',Charset:'UTF-8'}}}}
   }));
   console.log('simulator',JSON.stringify({messageId:r.MessageId}));
 } catch(e) { console.log('simulator',JSON.stringify({error:e.name,status:e.$metadata?.httpStatusCode})); process.exitCode=1; }
}
client.destroy();
