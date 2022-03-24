const materialize           = require("./materialize.min.js");
const Clean                 = require("../mainModules/Clean");
function FormValidator (){}

FormValidator.isRequired = value => value === '' ? false : true;

FormValidator.isBetween = (length, min, max) => length < min || length > max ? false : true;

FormValidator.isEmailValid = (email) => {
    const re = /^((([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))[ ]*[,]?[ ]*)+$/;
    return re.test(email);
};

/*
------ Password RegEx Meaning -------
^	                :  The password starts
(?=.*[a-z])	        :  The password must contain at least one lowercase character
(?=.*[A-Z])	        :  The password must contain at least one uppercase character
(?=.*[0-9])	        :  The password must contain at least one number
(?=.*[!@#$%^&*])	:  The password must contain at least one special character.
(?=.{8,})	        :  The password must be eight characters or longer
-------------------------------------
*/
FormValidator.isPasswordSecure = (password) => {
    const re = new RegExp("^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])(?=.{8,})");
    return re.test(password);
};

FormValidator.showError = (input, message) => {
    // get the form-field element
    const formField = input.parentElement;

    // add the error class
    formField.classList.remove('success');
    formField.classList.add('error');

    // show the error message
    const error = formField.querySelector('small');
    error.textContent = message;
};

FormValidator.showSuccess = (input) => {
    // get the form-field element
    const formField = input.parentElement;

    // remove the error class
    formField.classList.remove('error');
    formField.classList.add('success');

    // hide the error message
    const error = formField.querySelector('small');
    error.textContent = '';
}

FormValidator.checkEmailAddress = (emailEl) => {
    let valid = false;
    const email = Clean.cleanForm(emailEl.value.trim());

    if (!FormValidator.isRequired(email)) {
        FormValidator.showError(emailEl, 'Email cannot be blank.');
    } else if (!FormValidator.isEmailValid(email)) {
        FormValidator.showError(emailEl, 'Email format is not valid.')
    } else {
        FormValidator.showSuccess(emailEl);
        valid = true;
    }
    return valid;
}

FormValidator.checkIncomingHost = (domain) => {

    let valid = false;
    const domainName = Clean.cleanForm(domain.value.trim());
    if (!FormValidator.isRequired(domainName)) {
        FormValidator.showError(domain, 'Incoming mail server name cannot be blank.');
    } else {
        FormValidator.showSuccess(domain);
        valid = true;
    }
    return valid;
}

FormValidator.checkOutgoingHost = (domain) => {
    let valid = false;
    const domainName = Clean.cleanForm(domain.value.trim());
    if (!FormValidator.isRequired(domainName)) {
        FormValidator.showError(domain, 'Outgoing mail server name cannot be blank.');
    } else {
        FormValidator.showSuccess(domain);
        valid = true;
    }
    return valid;
}

FormValidator.checkPort = (port) => {
    let valid = false;
    const portNo = Clean.cleanForm(port.value.trim());
    if (!FormValidator.isRequired(portNo)) {
        FormValidator.showError(port, 'Port number cannot be blank.');
    } else {
        FormValidator.showSuccess(port);
        valid = true;
    }
    return valid;
}

FormValidator.checkUsername = (usernameEl) => {
    let valid = false;
    const min = 1;
    const max = 40;
    const username = Clean.cleanForm(usernameEl.value.trim());
    if (!FormValidator.isRequired(username)) {
        FormValidator.showError(usernameEl, 'Name should not be blank.');
    } else if (!FormValidator.isBetween(username.length, min, max)) {
        FormValidator.showError(usernameEl, `Name length should have less than ${max} characters.`)
    } else {
        FormValidator.showSuccess(usernameEl);
        valid = true;
    }
    return valid;
}

FormValidator.checkEmailSubject = (textEl) => {
    let isSubjectEmpty = textEl.value === '' ? true : false;
    if (isSubjectEmpty) {
        let toastHTML = '<span>Are you sure you want to send this message without Subject ?</span><button class="btn-flat toast-no-subject">Yes</button><button class="btn-flat toast-give-subject">No</button>';
        M.toast({html: toastHTML, displayLength: Infinity, classes: 'rounded'});
        document.querySelector('#send').disabled = true;
        FormValidator.showSuccess(textEl);
        return false;
    }
    else {
        FormValidator.showSuccess(textEl);
        return true;
    }
}

FormValidator.checkEmailBody = (textEl) => {
    FormValidator.showSuccess(textEl);
    return true;
}

FormValidator.checkPassword = (passwordEl) => {
    let valid = false;
    const password = Clean.cleanForm(passwordEl.value.trim());
    if (!FormValidator.isRequired(password)) {
        FormValidator.showError(passwordEl, 'Password cannot be blank.');
    } else {
        FormValidator.showSuccess(passwordEl);
        valid = true;
    }
    return valid;
};

FormValidator.checkConfirmPassword = (passwordEl, confirmPasswordEl) => {
    let valid = false;
    // check confirm password
    const confirmPassword = confirmPasswordEl.value.trim();
    const password = passwordEl.value.trim();
    if (!FormValidator.isRequired(confirmPassword)) {
        FormValidator.showError(confirmPasswordEl, 'Please enter the password again');
    } else if (password !== confirmPassword) {
        FormValidator.showError(confirmPasswordEl, 'Confirm password does not match');
    } else {
        FormValidator.showSuccess(confirmPasswordEl);
        valid = true;
    }
    return valid;
};

FormValidator.debounce = (fn, delay = 500) => {
    let timeoutId;
    return (...args) => {
        // cancel the previous timer
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        // setup a new timer
        timeoutId = setTimeout(() => {
            fn.apply(null, args)
        }, delay);
    };
};

module.exports = FormValidator;