var $ = require("../../lib/jquery.js");

// TODO global state is bad
var activePair = null;

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
    id: "selfpass-popup-box",
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

function insertIcon(targetPair, credentialList) {
  function isWithinButton(e, target) {
    var parentOffset = target.parent().offset();
    var relX = e.pageX - parentOffset.left;
    var relY = e.pageY - parentOffset.top;

    relX = target.width() - relX;
    relY = target.height() - relY;

    if (relX < 25 && relY < 25) {
      return true;
    }
    return false;
  }


  for (const target of targetPair) {
    var iconPath = chrome.extension.getURL("build/assets/ic_vpn_key_black_24dp_1x.png");
    target.css('background-image', 'url("' + iconPath + '")');
    target.addClass("selfpass-target-box");

    target.click(function(e){
      //TODO this is probably a bad idea
      e.stopPropagation();

      if (isWithinButton(e, target)) {
        activePair = targetPair;
        openPopup(target, credentialList);
      }
    });

    target.mousemove(function(e){
      if (isWithinButton(e, target)) {
        target.css('cursor', 'pointer');
      } else {
        target.css('cursor', 'default');
      }
    })
  }
}

function closePopup() {
  activePair = null;
  $("#selfpass-popup-box").remove();
}

chrome.runtime.sendMessage({message:"get-credentials"}, function(response){
  if (response.length === 0) {
    return;
  }

  var targetGroups = findTargetInputs();
  for (const pair of targetGroups) {
    console.log("Adding icon for: ", pair);
    insertIcon(pair, response);
  }

  $(document).on('click', closePopup);

  chrome.runtime.onMessage.addListener(function(request, sender){
    console.log(request, sender, activePair);
    if (request.message === "fill-credentials" && activePair !== null) {
      activePair[0].val(request.creds.username);
      activePair[1].val(request.creds.password);
      closePopup();
    }
  });
});
