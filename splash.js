(function () {
  var splash = document.getElementById("splash");
  var target = document.getElementById("splashTagline");
  if (!splash || !target) return;

  var message = "Chaque famille compte. Chaque geste fait grandir Sinaï.";
  var i = 0;

  function typeChar() {
    if (i >= message.length) {
      splash.classList.add("typing-done");
      setTimeout(finish, 1100);
      return;
    }
    target.textContent += message.charAt(i);
    i += 1;
    setTimeout(typeChar, 42);
  }

  function finish() {
    splash.classList.add("hide");
    setTimeout(function () { splash.style.display = "none"; }, 1200);
  }

  setTimeout(typeChar, 1450);
})();
