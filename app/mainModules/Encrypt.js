const CryptoJS    = require("crypto-js");
const scrypt      = require('scryptsy');
const bcrypt      = require("bcrypt");
const keytar      = require('keytar');
const openpgp     = require('openpgp');
const jetpack     = require('fs-jetpack');
const Utils       = require('./Utils');
const Clean       = require('./Clean');


function Encrypt () {

}


/**
 * Uses 'scrypt' to construct the a key from the hashed (using 'bcrypt') user password 
 * (which is stored in the OS's keychain) and from a constant salt.
 * The key is used to encrypt/ decrypt user's account password.
 *
 * @param  {object} loginInfo
 * @return {Buffer} 
 */
Encrypt.keyDerivationFunction = async function(loginInfo){
    /*
       The functon is run with the 'loginInfo' parameter only when the user is new, and enters the password for the
       first time. When an existing user uses the app, the function is run without the 'loginInfo' arguement, since
       in this case, we want to decrypt the user's password that was stored in the DB in the previous session.
    */
                         
    /*
        A salt is required for scrypt to derive an encryption key from a password. A salt is a random value used to 
        mitigate rainbow tables. It does not need to be kept secret, but it needs to be consitent as only the same 
        password and salt combination will result in the same key. Instead of using fixed salt value we can generate 
        a salt on the first run of the app and store it somewhere. This will make the app more resilient to rainbow 
        table attacks, but the encrypted database will no longer be portable.
    */
    const scryptSalt = Buffer.from('FrcHay/J2isc0HcPPYyWAn==');

    /*
        Retrieve the hashed user password from the system keychain. If keychain does not contain the hash, 
        use 'bcrypt' with random salt to hash user's password, then store it in the keychain. 
        This, along with the constant salt (scryptSalt), will be used by scrypt to generate an encryption 
        key (which will be used to encrypt the account's password in order to store it inside the DB). 
    */
    let hashedPassword = await keytar.getPassword('email-client', 'accountPasswordHash');

    if ( !hashedPassword ) {
        // Generate the bcrypt hash from the loginInfo.password. The salt in this case does not to be stored
        // since the hashing is performed only the first time the user logs in. (scryptSalt on the other hand
        // needs to be the same each time, since the key is generated anew every time the app launches).
        const passwordSaltRounds = 10;
        const plaintextPassword = loginInfo.password; 
        const bcryptSalt = bcrypt.genSaltSync(passwordSaltRounds);
        const hashedPassword = bcrypt.hashSync(plaintextPassword, bcryptSalt);
 

        // Set the password hash in the OS's keychain.
        await keytar.setPassword('email-client', 'accountPasswordHash', hashedPassword);
        console.log('Added hashed user password to the system keychain.');

        /*
            'scrypt' uses the password hash, salt, and other parameters to derive the encryption key. The other parameters 
            determine how much time it takes the CPU to derive the key, which mitigates brute force attacks, except for the
            last parameter which specifies the length of the key in bytes. A change to any of these parameters will result 
            in a different key.
        */
        const key = scrypt(hashedPassword, scryptSalt, 32768, 8, 1, 32)
        return key;
    }
    else {
        /*
        'scrypt' uses the password, salt, and other parameters to derive the encryption key. The other parameters 
        determine how much time it takes the CPU to derive the key, which mitigates brute force attacks, except for the
        last parameter which specifies the length of the key in bytes. A change to any of these parameters will result 
        in a different key.
        */
        const key = scrypt(hashedPassword, scryptSalt, 32768, 8, 1, 32);
        return key;
    }
}


/**
 * Delete the accountPasswordHash from the OS's keychain / Credential Manager.
 *
 */
Encrypt.deleteAppKey = async function(){
    await keytar.deletePassword('email-client', 'accountPasswordHash');
    console.log(`Deleted previous user's hashed password from the system keychain.`);
}


/**
 * Encrypt plaintext with AES256-CBC using the specified key.
 * If the key is in 'Buffer' format it must be converted to String
 * before passing it as an arguement.
 *
 * @param  {String} key
 * @param  {Object} plaintext
 * @return {Object} 
 */
Encrypt.encryptAES256CBC = function(key, plaintext) {
    let ciphertext = CryptoJS.AES.encrypt(JSON.stringify(plaintext), key, { 
        padding: CryptoJS.pad.Pkcs7,
        mode: CryptoJS.mode.CBC,
        hasher: CryptoJS.algo.SHA256
      }
    ).toString();
    return ciphertext;
}


/**
 * Decrypt ciphertect with AES256-CBC using the specified key. 
 * If the key is in 'Buffer' format it must be converted to String
 * before passing it as an arguement.
 *
 * @param  {String} key
 * @param  {Object} ciphertext
 * @return {Object} 
 */
Encrypt.decryptAES256CBC = function(key, ciphertext) {
    const bytes  = CryptoJS.AES.decrypt(ciphertext, key, { 
            padding: CryptoJS.pad.Pkcs7,
            mode: CryptoJS.mode.CBC,
            hasher: CryptoJS.algo.SHA256
        }
    );
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}


/**
 * Create new (Open)PGP key pair and save it as .asc files in the 'keys' directory of the 'appPath'. 
 * The private key is encrypted with the specified passphrase. The passphrase is encypted using a 
 * key generated with scrypt from the hashed account password present in the OS's keychain. Then it is 
 * stored in 'getPass.txt' for later use.
 *
 * @param  {String} passphrase
 * @param  {Object} accountInfo
 * @param  {String} appPath
 * @return {Object} 
 */
Encrypt.createPGPKeyPair = async function(passphrase, accountInfo, appPath){
    let fs = jetpack.cwd(appPath);
    fs.dir(`keys`);
    fs = jetpack.cwd(appPath, `keys`);
    fs.dir(`${Utils.md5(accountInfo.user)}`);
    fs = jetpack.cwd(appPath, `keys`, `${Utils.md5(accountInfo.user)}`);

    /*
        The hashed account password used in the scrypt function uses bcrypt with random salt in order to be generated.
        So the account password hash is different every time it is calculated. If the user is logged out due to a disconnect 
        or via the logout button, the scrypt key will be different each time the user logs back in since the password
        hash will be different (due to the bcrypt salt randomness).
        Thats the reason why when it has been generated, the hashed password is stored in OS's keychain, so it can 
        be used to generate the same scrypt key each time (scrypt uses the same salt each time - bcrypt uses different/ random
        one). So if the does not disconnect or log out, the scrypt key will always be the same, since it uses the 
        same hashed password from the OS keychain.

        The above logic is used to encrypt the user password after the user logs in via the welcome screen. 
        - We generate a password hash via bcrypt with random salt, and we store it the OS keychain. 
          Since the keychain is unencrypted, even if an attacker accesses the keychain, they cannot reverse the 
          hash with the salt to find the password. (The fact that the salt changes every time there is a disconnect 
          or logout makes this even better.)
        - We use scrypt function to generate a key, using the above password hash and a constant salt. The scrypt 
          key is always the same IF the password hash is the same (which means that the user has not logged out or
          disconnected as explained above), since the scrypt salt is always the same.
        - The key generated by scrypt is used to encrypt the original password user submitted in the welcome form,
          which then is stored (encrypted) in the database.
        - If the user closes the app and then launches it again without logging out or disconnecting, then the
          password hash is retrieved from the OS keychain, and then scrypt produces the key used to decrypt the
          encrypted password that is stored in the accounts database.
        - If the user logs out or is disconnected, the password hash is deleted from the keychain, and all the
          account info is deleted from the accounts database. Next time the user opens the app and submits the 
          password in the welcome form, a new hash is calculated, stored in the keychain, and a new scrypt key
          that is used to encrypt the password once again.

        When we need to encypt the private key passphrase the logic is a bit different. We need the same passphrase
        each time we use the specific private key. So the encrypted passphase needs to be the same every time, even
        if the user logs out or is disconnected. This means that we cannot use the same scrypt key to encrypt
        the passphrase, like we did with the account password. The solution is to use the original unencrypted 
        user account password as the KEY to encrypt the passphrase before storing the encrypted key in 'getPass.txt'.
        So:
        - We fetch the hashed account password from the keychain and generate the scrypt key.
        - We use the scrypt key to decrypt the account password from the accounts database. 
        - We use the unencrypted account password to encrypt the private key passphrase.
        - We store the encrypted passphrase inside 'getPass.txt'.
    */
    let scryptKey = (await Encrypt.keyDerivationFunction(accountInfo)).toString();
    let decryptedAccountPassword = Encrypt.decryptAES256CBC(scryptKey, accountInfo.password);
    let encyptedPassphrase = Encrypt.encryptAES256CBC(decryptedAccountPassword, passphrase);
    fs.write(`getPass.txt`, encyptedPassphrase);
 
    // Both the curve25519 and ed25519 curve options generate a primary key for signing using Ed25519 and 
    // a subkey for encryption using Curve25519.
    const { privateKey, publicKey} = await openpgp.generateKey({ // in base-64
        type: 'ecc', // Elliptic Curve 
        curve: 'curve25519', // ECC curve name 
        userIDs: [{ name: accountInfo.smtp.name, email: accountInfo.user}], // Multiple user IDs can be used.
        passphrase: passphrase, // protects the private key with the unencrypted passphrase
        format: 'armored' // output key format, defaults to 'armored' (other options: 'binary' or 'object')
    });

    fs.write(`${accountInfo.user}-public.asc`, publicKey);
    fs.write(`${accountInfo.user}-private.asc`, privateKey);
    fs = null;
}

/**
 * Import a (Open)PGP key pair and save it as .asc files in the 'keys' directory of the 'appPath'. 
 * The private key is encrypted with the specified passphrase. The passphrase is encypted using a 
 * key generated with scrypt from the hashed account password present in the OS's keychain. Then it is 
 * stored in 'getPass.txt' for later use.
 *
 * @param  {String} passphrase
 * @param  {Object} accountInfo
 * @param  {String} appPath
 * @return {Object} 
 */
 Encrypt.importPGPKeyPair = async function(passphrase, publicKeyPath, privateKeyPath, accountInfo, appPath){
    let fs = jetpack.cwd(appPath);
    fs.dir(`keys`);
    fs = jetpack.cwd(appPath, `keys`);
    fs.dir(`${Utils.md5(accountInfo.user)}`);
    fs = jetpack.cwd(appPath, `keys`, `${Utils.md5(accountInfo.user)}`);

    // Read content of the publicKeyPath and privateKeyPath
    let publicKey = Clean.cleanForm(await jetpack.readAsync(publicKeyPath));
    let privateKey = Clean.cleanForm(await jetpack.readAsync(privateKeyPath));

    // Confirm that the imported key belongs to the specific user (email address).
    // Also confirm that the specified passphrase (parameter) can indeed decrypt the private key.
    let isPrivateKeyOK = await Encrypt.testPrivateKey(privateKey, passphrase, accountInfo.user);
    let isPublicKeyOK = await Encrypt.testPublicKey(publicKey, accountInfo.user);
  
    if (isPrivateKeyOK && isPublicKeyOK) {
        // See 'Encrypt.createNewPGPKeyPair()' for the logic here. 
        let scryptKey = (await Encrypt.keyDerivationFunction(accountInfo)).toString();
        let decryptedAccountPassword = Encrypt.decryptAES256CBC(scryptKey, accountInfo.password);
        let encyptedPassphrase = Encrypt.encryptAES256CBC(decryptedAccountPassword, passphrase);
        fs.write(`getPass.txt`, encyptedPassphrase);

        fs.write(`${accountInfo.user}-public.asc`, publicKey);
        fs.write(`${accountInfo.user}-private.asc`, privateKey);
        fs = null;
        return true;
    }
    else {
        fs = null;
        return false;
    }
}


/**
 * Read the armored PGP public key of another user (stored in contacts). Parse the public key
 * and return the parsed key object.
 *
 * @param  {Object} accountInfo
 * @param  {String} appPath
 * @return {Object} 
 */
 Encrypt.getContactPublicKeyWithoutArmor = async function (publicKeyArmored){
    const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
    return publicKey;
}


/**
 * Read the saved armored public PGP key of the user and return the unarmored parsed key object.
 *
 * @param  {Object} accountInfo
 * @param  {String} appPath
 * @return {Object} 
 */
Encrypt.getOwnPublicKeyWithoutArmor = async function (accountInfo, appPath){
    /*
        Key 'armoring' is not encryption. Encryption prevents unauthorized use of data (formally, provides 
        confidentiality) by making it unreadable in a way that can only be reversed by someone who has the
        secret key. Armoring is a simple process that can be easily reversed by anybody who reads the specification.
        Armoring looks like text while unarmored (binary) data looks like garbage to a person who uses 
        inappropriate tools like cat or a text editor, but they are equally readable by someone competent.

        The purpose of armor is to assist in correct processing. In the days when PGP was created to be used for 
        email, most email systems could only handle text and would damage, mangle, or entirely discard binary data.
        For PGP messages, and keyblocks, which are inherently binary, to be successfully transmitted, they were 
        'armored' into textual form, and un-armored when received and processed. Nowadays nearly all email systems 
        do handle binary data and this is rarely needed, but armoring still can be useful if you want to process 
        the data using tools designed for text, for example cut-and-paste, or a webpage (HTML handles text but not binary).
    */
   try {
        let fs = jetpack.cwd(appPath, `keys`, `${Utils.md5(accountInfo.user)}`);
        const publicKeyArmored = await fs.readAsync(`${accountInfo.user}-public.asc`);

        const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
        return publicKey;
   } catch (error) {
       console.error(error);
   }

}

/**
 * Read the saved (encrypted) armored private PGP key of the user, decrypt it with the stored
 * passphrase and return the unarmored and decrypted parsed key object.
 *
 * @param  {Object} accountInfo
 * @param  {String} appPath
 * @return {Object} 
 */
Encrypt.getOwnPrivateKeyUnencryptedWithoutArmor = async function (accountInfo, appPath){
    /*
        Key 'armoring' is not encryption. Encryption prevents unauthorized use of data (formally, provides 
        confidentiality) by making it unreadable in a way that can only be reversed by someone who has the
        secret key. Armoring is a simple process that can be easily reversed by anybody who reads the specification.
        Armoring looks like text while unarmored (binary) data looks like garbage to a person who uses 
        inappropriate tools like cat or a text editor, but they are equally readable by someone competent.

        The purpose of armor is to assist in correct processing. In the days when PGP was created to be used for 
        email, most email systems could only handle text and would damage, mangle, or entirely discard binary data.
        For PGP messages, and keyblocks, which are inherently binary, to be successfully transmitted, they were 
        'armored' into textual form, and un-armored when received and processed. Nowadays nearly all email systems 
        do handle binary data and this is rarely needed, but armoring still can be useful if you want to process 
        the data using tools designed for text, for example cut-and-paste, or a webpage (HTML handles text but not binary).
    */
   try {
        let fs = jetpack.cwd(appPath, `keys`, `${Utils.md5(accountInfo.user)}`);

        const privateKeyArmored = await fs.readAsync(`${accountInfo.user}-private.asc`);
        const encryptedPassphraseKey = await fs.readAsync(`getPass.txt`);

        // As the passphrase for decrypting the private key, use the passphrase that is stored in 'getPass.txt',
        // after decrypting it with the scrypt key.
        let scryptKey = (await Encrypt.keyDerivationFunction(accountInfo)).toString();
        let decryptedAccountPassword = Encrypt.decryptAES256CBC(scryptKey, accountInfo.password);
        let decryptedPassphraseKey = Encrypt.decryptAES256CBC(decryptedAccountPassword, encryptedPassphraseKey);
        
        let privateKey;
        try {
            privateKey = await openpgp.decryptKey({
                privateKey: await openpgp.readKey({ armoredKey: privateKeyArmored }),
                passphrase: decryptedPassphraseKey
            });
        } catch (error) {
            console.error(error);
        }
        return privateKey; 
   } catch (error) {
        console.error(error);
   }
}

/**
 * Test if the specified private key can be decrypted and parsed (using the specified passphrase).
 * Also check if the private key is indeed the user's by checking the emailAddress that was used
 * when creating it.
 *
 * @param  {String} privateKeyEncryptedAndArmored
 * @param  {String} unencryptedPassphrase
 * @param  {String} userEmailAddress
 * @return {Boolean} 
 */
Encrypt.testPrivateKey = async function(privateKeyEncryptedAndArmored, unencryptedPassphrase, userEmailAddress){
    let privateKeyDecryptedUnarmored;
    let keyBelongsToUser = false;

    try {
        privateKeyDecryptedUnarmored = await openpgp.decryptKey({
            privateKey: await openpgp.readKey({ armoredKey: privateKeyEncryptedAndArmored }),
            passphrase: unencryptedPassphrase
        });

        if (privateKeyDecryptedUnarmored) {
            // Confirm that the imported key belongs to the specific user (email address).
            try {
                let keyEmailAddress = privateKeyDecryptedUnarmored.users[0].userID.email;
                if (keyEmailAddress === userEmailAddress){
                    keyBelongsToUser = true;
                }
            } catch (error) {
                console.error(error);
            }

            if (keyBelongsToUser) return true;
            else return false;
        }
        else return false;
    } catch (error) {
        console.error(error);
        return false;
    }
}


/**
* Test if the specified public key can be parsed. Also check if it is indeed the user's by checking the 
* emailAddress that was used when creating it.
*
* @param  {String} publicKeyArmored
* @param  {String} userEmailAddress
* @return {Boolean} 
*/
Encrypt.testPublicKey = async function (publicKeyArmored, userEmailAddress){
    try {
        const publicKeyUnarmored = await openpgp.readKey({ armoredKey: publicKeyArmored });
        if (publicKeyUnarmored){
            try {
                let keyEmailAddress = publicKeyUnarmored.users[0].userID.email;
                if (keyEmailAddress === userEmailAddress){
                    return true;
                }
                else {
                    return false;
                }
            } catch (error) {
                console.error(error);
                return false;
            }
        }
    } catch (error) {
        console.error(error);
        return false;
    }
    
 
}


Encrypt.prepareMessageForDetachedVerification = function (decryptedMessage, multiPartSignedBoundary, onlySignedMessage){
    let boundaryIndexes = Utils.findSubstringPositionsInString(decryptedMessage, multiPartSignedBoundary);

    // Keep only the string part begining after the first boundary (we do not want the multipart/signed part) 
    // until the part before the detached PGP signature begins.
    // We use 'boundaryIndexes[1]' and not 'boundaryIndexes[0]' since the first time the boundary is found is inside the headers.
    let startingBoundary = boundaryIndexes[1] + multiPartSignedBoundary.length; // First time that the boundary appears
    let endingBoundary = boundaryIndexes[boundaryIndexes.length - 2];   // (Last time - 1) that the boundary appears 
    let originalMessage = decryptedMessage.slice(0, endingBoundary);
    originalMessage = originalMessage.slice(startingBoundary, originalMessage.length - 2); // length - 2 : Remove the last two '--' after the ending boundary

    // Convert canonical UNIX linebreaks (CR LF - \r\n) into local linebreaks (\n) in order to use split().
    // If the message source is the client itself then the linebreaks will usually be in canonical format. If the
    // message is source is the decrypted PGP attachment, the linebreaks will be in local format by default.
    originalMessage = originalMessage.replace(/\r\n/g, "\n");

    // Remove not wanted linebreaks.
    let textArray = originalMessage.split(/^/gm); // ^ : Split the message string at the line breaks (\n).
    if (textArray[0] === "\n") textArray.splice(0, 1); // Remove possible linebreak in the first line of the 'originalMessage'
    if (textArray[textArray.length - 1] === "\n") textArray.splice(textArray.length - 1, 1); // Remove possible linebreak at the last line (a line that only contains a linebreak).
    textArray[textArray.length - 1] = Utils.removeLinebreaks(textArray[textArray.length - 1]); // Remove all linebreaks in the last line (after the boundary it is possible that a linebreak remains causing the whole message to appear as it had an empty line at the end)

    // Construct the original break again, after removing the unwanted linebreaks.
    originalMessage = textArray.join('');
    textArray = null;
    
    /*
        RFC 3156: 
        Upon receipt of a signed message, an application MUST:
        (1) :  Convert line endings to the canonical <CR><LF> sequence before the signature can be verified.
               This is necessary since the local MTA may have converted to a local end of line convention.
        (2) :  Pass both the signed data and its associated content header along with the OpenPGP signature to 
               the signature verification service.
    */
    // Revert back to the UNIX canonical format.
    let originalMessageCanonical = originalMessage.replace(/\n/g, "\r\n");

    /*
        RFC 3156: 
        The accepted OpenPGP convention is for signed data to end with a <CR><LF> sequence. Note that the <CR><LF> 
        sequence immediately preceding a MIME boundary delimiter line is considered to be part of the delimiter. 
        Thus, it is not part of the signed data preceding the delimiter line. An implementation which elects to 
        adhere to the OpenPGP convention has to make sure it inserts a <CR><LF> pair on the last line of the data 
        to be signed and transmitted (signed message and transmitted message MUST be identical).
    */
    originalMessageCanonical = originalMessageCanonical + '\r\n';
    return originalMessageCanonical;
}


Encrypt.openPGPVerifyNonDetachedSignature = async function(cleartextMessage, senderPublicKey){
    try {
   
        const message = await openpgp.createMessage({ text: cleartextMessage });
   
        const publicKeyUnarmored = await openpgp.readKey({ armoredKey: senderPublicKey });
    
        const verificationResult = await openpgp.verify({
            message: message,
            verificationKeys: publicKeyUnarmored
        });
        console.log(verificationResult)
    
        const { verified, keyID } = verificationResult.signatures[0];
    
        try {
            await verified; // throws on invalid signature
            console.log('Signed by Key ID : ' + keyID.toHex());
            return 'verified';
        } catch (e) {
            throw new Error('Signature could not be verified: ' + e.message);
        }
    } catch (error) {
        console.error(error);
        return 'not signed';
    }
}


Encrypt.openPGPVerifyDetachedSignature = async function(cleartextMessage, senderPublicKey, detachedSignature){
    try {
        const message = await openpgp.createMessage({ text: cleartextMessage });
   
        const signature = await openpgp.readSignature({
            armoredSignature: detachedSignature // parse detached signature
        });
    
        const publicKeyUnarmored = await openpgp.readKey({ armoredKey: senderPublicKey });
 
        const verificationResult = await openpgp.verify({
            message, // Message object
            signature,
            verificationKeys: publicKeyUnarmored
        });
    
        const { verified, keyID } = verificationResult.signatures[0];
        
        try {
            await verified; // throws on invalid signature
            console.log('Signed by Key ID : ' + keyID.toHex());
            return true;
        } catch (e) {
            throw new Error('Signature could not be verified: ' + e.message);
        } 
    } catch (error) {
        console.error(error)
    }
}


Encrypt.openPGPDecrypt = async function(encyptedMessage, accountInfo, appPath){
    try {
        const privateKeyUnarmored = await Encrypt.getOwnPrivateKeyUnencryptedWithoutArmor(accountInfo, appPath);
   
        const message = await openpgp.readMessage({
            armoredMessage: encyptedMessage // parse armored message
        });
    
        const { data: decrypted} = await openpgp.decrypt({
            message,
            decryptionKeys: privateKeyUnarmored
        });
    
        return decrypted;
    } catch (error) {
        console.error(error);
    }
}


Encrypt.openPGPDecryptAndVerify = async function(encyptedMessage, senderPublicKey, accountInfo, appPath){
    try {
        const privateKeyUnarmored = await Encrypt.getOwnPrivateKeyUnencryptedWithoutArmor(accountInfo, appPath);
        const publicKeyUnarmored = await openpgp.readKey({ armoredKey: senderPublicKey });

        const message = await openpgp.readMessage({
            armoredMessage: encyptedMessage // parse armored message
        });
    
        const { data: decrypted, signatures} = await openpgp.decrypt({
            message,
            verificationKeys: publicKeyUnarmored,
            decryptionKeys: privateKeyUnarmored
        });

        if (signatures && signatures[0]){
            try {
                await signatures[0].verified; // throws on invalid signature
                console.log('Signature is valid');
                return [decrypted, await signatures[0].verified];
            } catch (e) {
                console.error(e);
                return [decrypted, await signatures[0].verified];
            }
        }
        else {
            return [decrypted, 'notsigned'];
        }
    } catch (error) {
        console.error(error);
    }
}

/**
 * Delete the whole 'keys' directory containing all the user's (Open)PGP key pairs.
 *
 * @param  {String} appPath
 */
Encrypt.deleteKeyFolder = async function(appPath){
    fs = jetpack.cwd(appPath, `keys`);
    let allContent = fs.find(`.`, {files : true, directories : true});
    allContent.forEach(fileOrFolder => {
      fs.remove(`${fileOrFolder}`);
      console.log(`Removed ${fileOrFolder} from key store.`);
    });
}


module.exports = Encrypt;