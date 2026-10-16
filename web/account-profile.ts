import {avatarElement,type PublicProfile} from './profile-display.js';
type Profile=PublicProfile&{revision:number;avatarVersion:string|null};
export type AccountApi=(path:string,body?:unknown,photo?:{blob:Blob;revision:number})=>Promise<any>;
export function configureProfile(api:AccountApi){
  const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
  const form=$<HTMLFormElement>('profile-form'),photo=$<HTMLInputElement>('avatar-file'),status=$('profile-status');
  let profile:Profile|null=null,draft:Blob|null=null,draftPreview:string|null=null,generation=0,busy=false;
  function drawAvatar(data=draftPreview??profile?.avatarDataUrl??null){$('profile-photo').replaceChildren(avatarElement({displayName:profile?.displayName||profile?.handle||'Traveler',handle:profile?.handle??null,avatarDataUrl:data}));}
  function controls(){for(const c of $('profile-editor').querySelectorAll<HTMLButtonElement|HTMLInputElement>('button,input'))c.disabled=busy||!profile;
    $<HTMLButtonElement>('avatar-save').disabled=busy||!draft||!profile;$<HTMLButtonElement>('avatar-remove').disabled=busy||!profile?.avatarVersion;
    $<HTMLButtonElement>('profile-reload').disabled=busy;
  }
  function accept(saved:Profile,fields=true,keepPhoto=false){profile=saved;if(!keepPhoto){draft=null;draftPreview=null;photo.value='';}drawAvatar();
    $('profile-current').textContent=profile.handle?`${profile.displayName} · @${profile.handle}`:'Choose a name and unique handle';
    if(fields){$<HTMLInputElement>('profile-name').value=profile.displayName;$<HTMLInputElement>('profile-handle').value=profile.handle??'';}controls();
  }
  async function work(action:()=>Promise<void>){if(busy)return;busy=true;controls();status.textContent='';const current=generation;
    try{await action();}catch(error){if(current===generation)status.textContent=error instanceof Error?error.message:'Unable to update your profile.';}
    finally{busy=false;controls();}
  }
  async function load(){const current=++generation;profile=null;draft=null;draftPreview=null;photo.value='';controls();status.textContent='Loading your profile…';
    try{const data=await api('profile');if(current!==generation)return;accept(data.profile);status.textContent='';}
    catch(error){if(current===generation){status.textContent=error instanceof Error?error.message:'Unable to load your profile.';controls();}}
  }
  form.onsubmit=event=>{event.preventDefault();void work(async()=>{
    const data=await api('profile',{displayName:$<HTMLInputElement>('profile-name').value,handle:$<HTMLInputElement>('profile-handle').value,expectedRevision:profile!.revision});
    accept(data.profile,true,true);status.textContent=draft?'Profile saved. Choose Save photo to keep your photo preview.':'Profile saved. Your name and handle appear across your trips.';
  });};
  photo.onchange=()=>void work(async()=>{
    const file=photo.files?.[0];if(!file)return;draft=null;draftPreview=null;drawAvatar();$<HTMLButtonElement>('avatar-save').disabled=true;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Choose a JPEG, PNG or WebP photo smaller than 10 MB.');
    const current=generation,image=await createImageBitmap(file);
    try{
      if(image.width*image.height>16_000_000)throw Error('Choose a photo smaller than 16 megapixels.');
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const context=canvas.getContext('2d');if(!context)throw Error('Unable to prepare this photo.');
      const side=Math.min(image.width,image.height);context.drawImage(image,(image.width-side)/2,(image.height-side)/2,side,side,0,0,256,256);
      const data=canvas.toDataURL('image/webp',0.75),blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Unable to prepare this photo.')),'image/webp',0.75));
      if(current!==generation)return;draft=blob;draftPreview=data;drawAvatar();status.textContent='Photo preview. Choose Save photo to upload this cropped thumbnail.';
    }finally{image.close();}
  });
  $('avatar-save').onclick=()=>void work(async()=>{const data=await api('profile/avatar',undefined,{blob:draft!,revision:profile!.revision});accept(data.profile,false);status.textContent='Photo saved. It is visible to signed-in members of your trips.';});
  $('avatar-remove').onclick=()=>void work(async()=>{const data=await api('profile/remove-avatar',{expectedRevision:profile!.revision});accept(data.profile,false);status.textContent='Photo removed. Your initials will appear instead.';});
  $('profile-reload').onclick=()=>{if(!busy)void load();};
  return {load,reset(){generation++;profile=null;draft=null;draftPreview=null;form.reset();photo.value='';$('profile-photo').replaceChildren();$('profile-current').textContent='';status.textContent='';controls();}};
}
