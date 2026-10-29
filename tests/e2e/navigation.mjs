export async function openDisclosure(page,id){
  const details=page.locator(`#${id}`);
  if(!await details.evaluate(node=>node.open))await details.locator(':scope > summary').click();
}
