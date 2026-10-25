import type {SupabaseClient} from '@supabase/supabase-js';
import type {AccountBoundary} from './account-session.js';

// A restored/refreshed session is not proof of recent credential possession.
// Recovery proof is short-lived, single-use and never persisted by this app.
export class CredentialGuard {
  private recovery:{userId:string;expiresAt:number}|undefined;
  constructor(private client:SupabaseClient,private boundary:AccountBoundary,private now=Date.now){
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY'&&session)this.recovery={userId:session.user.id,expiresAt:this.now()+5*60_000};
      else if(event==='SIGNED_OUT'||event==='SIGNED_IN'||session?.user.id!==this.recovery?.userId)this.reset();
    });
  }
  reset(){this.recovery=undefined;}
  async authorize(password:string,allowRecovery=false):Promise<{current_password?:string}>{
    const generation=this.boundary.generation,userId=this.boundary.userId;
    let identity;try{identity=await this.client.auth.getUser();}catch{throw Error('Unable to verify your account. Sign in again and retry.');}
    this.boundary.check(generation);
    const user=identity.data.user;
    if(identity.error||!userId||user?.id!==userId||!user.email||!user.email_confirmed_at||user.is_anonymous)
      throw Error('Sign in with your confirmed email account before changing credentials.');
    if(allowRecovery&&this.recovery?.userId===userId&&this.recovery.expiresAt>this.now()){
      this.reset();return {};
    }
    this.reset();
    if(!password)throw Error('Enter your current password to confirm this change, or request a recovery email.');
    let result;try{result=await this.client.auth.signInWithPassword({email:user.email,password});}
    catch{throw Error('Unable to confirm your password. Check your connection and try again.');}
    this.boundary.check(generation);
    if(result.error||result.data.user?.id!==userId||!result.data.session||!result.data.user.email_confirmed_at||result.data.user.is_anonymous)
      throw Error('Your current password could not be confirmed. Try again or use email recovery.');
    return {current_password:password};
  }
}
