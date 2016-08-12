
chrome.runtime.sendMessage("get-credentials", function(response){
  console.log(response);
});
