import $ from "jquery";

// TODO global state is bad
var activeFillPair = null;
var activeGenerateElems = null;

function findTargetFillInputs(form){
  var username = form.find(":text");
  var password = form.find(":password");

  if (username.length && password.length == 1) {
    username = $(username[0]);
    password = $(password[0]);

    return [username, password];
  }
  return [];
}

function findTargetGenerateInputs(form) {
  console.log("looking for generate inputs");
  var passwords = form.find(":password");
  var username =  form.find(":text");

  if (passwords.length == 2) {
      return [$(passwords[0]), $(passwords[1]), $(username[0])];
  }
  return [];
}

function openPopup(elem, id, url, css) {
  console.log("Open popup");
  var contentBoxUrl = chrome.extension.getURL(url);
  var frame = $('<iframe>', {
    src: contentBoxUrl,
    id: id,
    frameborder: 0,
    scrolling: 'no'
  }).addClass("selfpass-popup-box");

  var offset = elem.offset();
  frame.css({
    top: (offset.top + elem.height() + 10) + "px",
    left: offset.left + "px",
  });

  if (typeof(css) !== "undefined") {
    frame.css(css);
  }

  frame.appendTo("body");
}

function openFillPopup(target, credentialList) {
  openPopup(target,
            "selfpass-popup-fill-box",
            "build/html/fill-popup.html",
            {
              // TODO: less magic here
              height: 50 + 80 * credentialList.length
            })
}

function openGeneratePopup(target, username) {
  const url = "build/html/generate-popup.html?username=" + encodeURIComponent(username);
  openPopup(target, "selfpass-popup-generate-box", url);
}

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

function insertButton(target, onClick) {
  var iconPath = chrome.extension.getURL("build/assets/ic_vpn_key_black_24dp_1x.png");
  console.log(target);
  target.css('background-image', 'url("' + iconPath + '")');
  target.addClass("selfpass-input-button");

  target.click(onClick);

  target.mousemove(function(e){
    if (isWithinButton(e, target)) {
      target.css('cursor', 'pointer');
    } else {
      target.css('cursor', 'default');
    }
  });
}

function insertGenerateButton(targetElems){
  for (const target of targetElems) {
    insertButton(target, function(e){
      e.stopPropagation();

      if (isWithinButton(e, target)) {
        activeGenerateElems = targetElems;

        const username = targetElems[targetElems.length - 1].val();
        openGeneratePopup(target, username);
      }
    });
  }
}

function insertFillButton(targetPair, credentialList) {
  for (const target of targetPair) {
    insertButton(target, function(e){
      closeFillPopup();

      //TODO this is probably a bad idea
      e.stopPropagation();

      if (isWithinButton(e, target)) {
        activeFillPair = targetPair;
        openFillPopup(target, credentialList);
      }
    });
  }
}

// Credit: https://stackoverflow.com/questions/6150289/
function toDataUrl(url, callback) {
  var xhr = new XMLHttpRequest();
  xhr.responseType = 'blob';
  xhr.onload = function() {
    var reader = new FileReader();
    reader.onloadend = function() {
      callback(reader.result);
    }
    reader.readAsDataURL(xhr.response);
  };
  xhr.open('GET', url);
  xhr.send();
}

function closeFillPopup() {
  activeFillPair = null;
  $("#selfpass-popup-fill-box").remove();
}

function closeGeneratePopup() {
  activeGenerateElems = null;
  $("#selfpass-popup-generate-box").remove();
}

function onFormAdded(callback) {
  function mutationHandler(mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function(node) {
        var forms = $(node).find("form");
        forms.each(function(){
          console.log("Found added form", $(this));
          callback($(this));
        });
      });
    });
  }
  var observerConfig = {
    childList: true,
    subtree: true
  };
  var observer = new MutationObserver(mutationHandler);
  observer.observe($("body")[0], observerConfig);
}

chrome.runtime.sendMessage({message:"login-status"}, function(response){
  if (response.isLoggedIn !== true) {
    return;
  }

  chrome.runtime.sendMessage({message:"get-credentials"}, function(response){
    if (Object.keys(response).length > 0) {
      function addFillInput(form) {
        const targetFillGroup = findTargetFillInputs(form);
        if (targetFillGroup.length > 0) {
          insertFillButton(targetFillGroup, response);
        }
      }
      $("form").each((i, e) => addFillInput($(e)));
      onFormAdded(addFillInput);
    }
  });

  function addGenerateButton(form){
    const targetGenerateGroup = findTargetGenerateInputs(form);
    if (targetGenerateGroup.length > 0) {
      insertGenerateButton(targetGenerateGroup, response);
    }
  }
  $("form").each((i, e) => addGenerateButton($(e)));
  onFormAdded(addGenerateButton);


  $(document).on('click', function(){
    closeFillPopup();
    closeGeneratePopup();
  });

  chrome.runtime.onMessage.addListener(function(request, sender){
    console.log(request, sender);
    if (request.message === "fill-credentials" && activeFillPair !== null) {
      activeFillPair[0].val(request.creds.username);
      activeFillPair[1].val(request.creds.password);
      closeFillPopup();
    } else if (request.message === "fill-generated-password" &&
               activeGenerateElems !== null) {
      activeGenerateElems[0].val(request.password);
      activeGenerateElems[1].val(request.password);
      activeGenerateElems[2].val(request.username);
      closeGeneratePopup();
    } else if (request.message === "close-fill-popup") {
      closeFillPopup();
    } else if (request.message === "close-generate-popup") {
      closeGeneratePopup();
    } else if (request.message === "request-save-credentials") {
      request.message = "save-credentials";
      request.url = window.location.href;

      toDataUrl(location.protocol + "//" + location.host + "/favicon.ico",
                function(data){
        if (data.substr(0, 10) === "data:image"){
          request.favicon = data;
        }
        chrome.runtime.sendMessage(request);
      })
    }
  });
});
