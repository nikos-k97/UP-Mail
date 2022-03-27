const CryptoJS   = require("crypto-js");
const scrypt     = require('scryptsy');
const keytar     = require('keytar');

function Encrypt (){
}

Encrypt.keyDerivationFunction = async function(loginInfo){
    /*
        A salt is required for scrypt to derive an encryption key from a password. A salt is a random value used to 
        mitigate rainbow tables. It does not need to be kept secret, but it needs to be consitent as only the same 
        password and salt combination will result in the same key. Instead of using fixed salt value we can generate 
        a salt on the first run of the app and store it somewhere. This will make the app more resilient to rainbow 
        table attacks, but the encrypted database will no longer be portable.
    */
    const dbSalt = Buffer.from('FrcHay/J2isc0HcPPYyWAn==');

    /*
        Retrieve the database encryption password from the system keychain. If no password exists in the keychain, 
        prompt the user for one, then store it in the keychain. This, along with the salt, will be used by scrypt 
        to generate an encryption key for the database. The same password must be used each time the app runs. 
        If the password is lost or forgotten, then the database cannot be decrypted or recovered.
    */
    let dbPass = await keytar.getPassword('email-client', 'app-general-key');
    if (dbPass === null) {
        await keytar.setPassword('email-client', 'app-general-key', loginInfo.password);
        /*
            'scrypt' uses the password, salt, and other parameters to derive the encryption key. The other parameters 
            determine how much time it takes the CPU to derive the key, which mitigates brute force attacks, except for the
            last parameter which specifies the length of the key in bytes. A change to any of these parameters will result 
            in a different key.
        */
        const key = scrypt(loginInfo.password, dbSalt, 32768, 8, 1, 32)
        return key;
    }
    else {
        /*
        'scrypt' uses the password, salt, and other parameters to derive the encryption key. The other parameters 
        determine how much time it takes the CPU to derive the key, which mitigates brute force attacks, except for the
        last parameter which specifies the length of the key in bytes. A change to any of these parameters will result 
        in a different key.
        */
        const key = scrypt(dbPass, dbSalt, 32768, 8, 1, 32)
        return key;
    }
}

Encrypt.encryptAES256CBC = function(key, plaintext) {
    let ciphertext = CryptoJS.AES.encrypt(JSON.stringify(plaintext), key, { 
        padding: CryptoJS.pad.Pkcs7,
        mode: CryptoJS.mode.CBC,
        hasher: CryptoJS.algo.SHA256
      }
    ).toString();
    return ciphertext;
}

Encrypt.decryptAES256CBC = function(key, ciphertext) {
    const bytes  = CryptoJS.AES.decrypt(ciphertext, key, { 
        padding: CryptoJS.pad.Pkcs7,
        mode: CryptoJS.mode.CBC,
        hasher: CryptoJS.algo.SHA256
        }
    );
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}


module.exports = Encrypt;