import type {SupabaseClient} from '@supabase/supabase-js';
import type {AccountBoundary} from './account-session.js';

// A restored/refreshed session is not proof of recent credential possession.
// Recovery proof is short-lived, single-use and never persisted by this app.
export class CredentialGuard {
  private recovery:{userId:string;expiresAt:number}|undefined;
  private emailProof:{userId:string;expiresAt:number}|undefined;
  constructor(private client:SupabaseClient,private boundary:AccountBoundary,private now=Date.now){
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY'&&session){this.emailProof=undefined;this.recovery={userId:session.user.id,expiresAt:this.now()+5*60_000};}
      else if(event==='SIGNED_OUT'||event==='SIGNED_IN')this.reset();
      else {
        if(session?.user.id!==this.recovery?.userId)this.recovery=undefined;
        if(session?.user.id!==this.emailProof?.userId)this.emailProof=undefined;
      }
    });
  }
  reset(){this.recovery=undefined;this.emailProof=undefined;}
  // Only an explicit PKCE exchange can mint proof; a stored session cannot.
  async completeEmailLink(code:string,flowId:string|undefined,pending:{email:string;userId:string|null;expiresAt:number}|null){
    this.reset();
    let result;try{result=await this.client.auth.exchangeCodeForSession(code,flowId?{flowId}:undefined);}
    catch{throw Error('This email link could not be verified. Check your connection and request a new link.');}
    const {data,error}=result;
    if(error)throw Error('This email link expired or could not be verified. Request a new link in this browser.');
    const user=data.user;
    if(pending&&pending.expiresAt>this.now()){
      if(!data.session||!user?.email_confirmed_at||user.is_anonymous||user.email?.toLowerCase()!==pending.email.toLowerCase()||pending.userId&&pending.userId!==user.id)
        throw Error('The email link belongs to a different account. Sign out and request a new link.');
      this.emailProof={userId:user.id,expiresAt:this.now()+5*60_000};
      return true;
    }
    return false;
  }
  async authorize(password:string,allowRecovery=false):Promise<{current_password?:string}>{
    const generation=this.boundary.generation,userId=this.boundary.userId;
    let identity;try{identity=await this.client.auth.getUser();}catch{throw Error('Unable to verify your account. Sign in again and retry.');}
    this.boundary.check(generation);
    const user=identity.data.user;
    if(identity.error||!userId||user?.id!==userId||!user.email||!user.email_confirmed_at||user.is_anonymous)
      throw Error('Sign in with your confirmed email account before changing credentials.');
    if(!allowRecovery&&this.emailProof?.userId===userId&&this.emailProof.expiresAt>this.now()){
      this.reset();return {};
    }
    if(allowRecovery&&this.recovery?.userId===userId&&this.recovery.expiresAt>this.now()){
      this.reset();return {};
    }
    this.reset();
    if(!password)throw Error('Enter your current password to confirm this change, or verify by email for a passkey change. Use a recovery email to set a password.');
    let result;try{result=await this.client.auth.signInWithPassword({email:user.email,password});}
    catch{throw Error('Unable to confirm your password. Check your connection and try again.');}
    this.boundary.check(generation);
    if(result.error||result.data.user?.id!==userId||!result.data.session||!result.data.user.email_confirmed_at||result.data.user.is_anonymous)
      throw Error('Your current password could not be confirmed. Try again or use email recovery.');
    return {current_password:password};
  }
}
