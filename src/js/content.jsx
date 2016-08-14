var $ = require("../../lib/jquery.js");


function findTargetInputs(){
  var targets = [];
  $("form").each(function(){
    var username = $(this).find(":text");
    var password = $(this).find(":password");

    if (username.length && password.length) {
      username = $(username[0]);
      password = $(password[0]);

      targets.push([username, password]);
    }
  });
  return targets;
}

function openPopup(target, credentialList) {
  console.log("Open popup");
  console.log("credentialList", credentialList);
  var contentBoxUrl = chrome.extension.getURL("build/html/content-box.html");
  var frame = $('<iframe>', {
    src: contentBoxUrl,
    frameborder: 0,
    scrolling: 'no'
  }).addClass("selfpass-content-box");

  var offset = target.offset();
  frame.css({
    top: (offset.top + target.height() + 10) + "px",
    left: offset.left + "px",

    // TODO: less magic here
    height: 50 + 80 * credentialList.length
  });
  frame.appendTo("body");
}

function insertIcon(target, credentialList) {
  var iconPath = chrome.extension.getURL("build/assets/ic_vpn_key_black_24dp_1x.png");
  target.css('background-image', 'url("' + iconPath + '")');
  target.addClass("selfpass-target-box");
  target.click(function(e){
    var parentOffset = $(this).parent().offset();
    var relX = e.pageX - parentOffset.left;
    var relY = e.pageY - parentOffset.top;

    relX = $(this).width() - relX;
    relY = $(this).height() - relY;

    if (relX < 20 && relY < 20) {
      openPopup($(this), credentialList);
    }
  });
}

chrome.runtime.sendMessage("get-credentials", function(response){
  if (response.length === 0) {
    return;
  }

  var targets = findTargetInputs();
  for (var pair of targets) {
    console.log("Adding icon for: ", pair);
    insertIcon(pair[0], response);
    insertIcon(pair[1], response);
  }
});
