var thePassword; //assigned by getPassword, at startup

function getPassword () {
	thePassword = localStorage.getItem ("odbBrowserPassword");
	if ((thePassword === null) || (thePassword.length === 0)) {
		thePassword = prompt ("What's the password for the odb server?");
		if (thePassword === null) {
			thePassword = "";
			}
		else {
			localStorage.setItem ("odbBrowserPassword", thePassword);
			}
		}
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
