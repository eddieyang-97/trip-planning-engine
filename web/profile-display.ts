export type PublicProfile={displayName:string;avatarDataUrl:string|null};
export function initials(name:string){const parts=(name.trim()||'Traveler').split(/\s+/);return (parts.length>1?[...parts[0]!][0]!+[...parts.at(-1)!][0]!:[...parts[0]!].slice(0,2).join('')).toLocaleUpperCase();}
export function avatarElement(profile:PublicProfile){
  const avatar=document.createElement('span');avatar.className='profile-avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent=initials(profile.displayName||'Traveler');
  if(profile.avatarDataUrl&&profile.avatarDataUrl.length<40_000&&/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(profile.avatarDataUrl)){
    const image=document.createElement('img');image.src=profile.avatarDataUrl;image.alt='';image.width=64;image.height=64;image.onerror=()=>{avatar.textContent=initials(profile.displayName||'Traveler');};avatar.replaceChildren(image);
  }
  return avatar;
}
