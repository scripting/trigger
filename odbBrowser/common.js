var thePassword; //assigned by getPassword, at startup

function getPassword () { //true if we have one; false means an entry form is on screen and the page should wait

	/*  Not prompt () -- Electron doesn't support it, and neither do some
		embedded browsers. A small form in the page works everywhere.  */

	thePassword = localStorage.getItem ("odbBrowserPassword");
	if ((thePassword !== null) && (thePassword.length > 0)) {
		return (true);
		}
	const divEntry = $("<div class=\"divPasswordEntry\"></div>");
	const inputPassword = $("<input type=\"password\" class=\"inputPassword\" placeholder=\"Password for the odb server\">");
	const buttonConnect = $("<button class=\"buttonConnect\">Connect</button>");
	function connect () {
		const theValue = inputPassword.val ();
		if (theValue.length > 0) {
			localStorage.setItem ("odbBrowserPassword", theValue);
			window.location.reload ();
			}
		}
	buttonConnect.click (connect);
	inputPassword.keydown (function (event) {
		if (event.which === 13) { //return key
			connect ();
			}
		});
	divEntry.append (inputPassword).append (buttonConnect);
	$("body").prepend (divEntry);
	inputPassword.focus ();
	return (false);
	}

function serverCall (path, params, method, callback) { //the one transport primitive -- JSON comes back
	var theUrl = path;
	var theQuery = "";
	var theBody;
	Object.keys (params).forEach (function (name) {
		if (name === "opmltext") { //the one param that travels as the body of a POST
			theBody = params [name];
			return;
			}
		if (params [name] !== undefined) {
			if (theQuery.length > 0) {
				theQuery += "&";
				}
			theQuery += name + "=" + encodeURIComponent (params [name]);
			}
		});
	if (theQuery.length > 0) {
		theUrl += "?" + theQuery;
		}
	$.ajax ({
		url: theUrl,
		type: method,
		data: theBody,
		contentType: (theBody === undefined) ? undefined : "text/xml",
		processData: false,
		headers: {"x-trigger-password": thePassword},
		dataType: "json",
		success: function (data) {
			callback (undefined, data);
			},
		error: function (xhr) {
			var err;
			try {
				err = JSON.parse (xhr.responseText);
				}
			catch (parseError) {
				err = {message: "Can't reach the odb server. The status was " + xhr.status + "."};
				}
			if (xhr.status === 401) { //a wrong saved password would lock the page forever -- forget it so the next visit asks again
				localStorage.removeItem ("odbBrowserPassword");
				}
			callback (err);
			}
		});
	}

function xmlEscape (theText) {
	return (String (theText)
		.split ("&").join ("&amp;")
		.split ("<").join ("&lt;")
		.split (">").join ("&gt;")
		.split ("\"").join ("&quot;"));
	}
