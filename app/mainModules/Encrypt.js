const CryptoJS    = require("crypto-js");
const scrypt      = require('scryptsy');
const keytar      = require('keytar');
const openpgp     = require('openpgp');
const jetpack     = require('fs-jetpack');
const Utils       = require('./Utils');


function Encrypt () {

}


/**
 * Construct the app-general-key from the user password and the salt.
 * The key is used to encrypt/ decrypt user's account password
 *
 * @param  {object} loginInfo
 * @return {Buffer} 
 */
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
    if (!dbPass) {
        await keytar.setPassword('email-client', 'app-general-key', loginInfo.password);
        console.log('Added database password to the system keychain.')
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


/**
 * Delete the app-general-key from the OS's keychain / Credential Manager.
 *
 */
Encrypt.deleteAppKey = async function(){
    await keytar.deletePassword('email-client', 'app-general-key');
    console.log('Deleted database password from the system keychain.')
}


/**
 * Encrypt plaintext with AES256-CBC using the app-general-key from the OS's
 * keychain. If the key is in 'Buffer' format it must be converted to String
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
 * Decrypt ciphertect with AES256-CBC using the app-general-key from the OS's
 * keychain. If the key is in 'Buffer' format it must be converted to String
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
 * Create new (Open)PGP key pair, along with a revocation certificate and save them
 * as .asc files in the 'keys' directory of the 'appPath'. The private key is encrypted
 * with the user account's password (which is decrypted using the app-general-key saved in
 * the OS's keychain / Credential Manager).
 *
 * @param  {Object} accountInfo
 * @param  {String} appPath
 */
Encrypt.createPGPKeyPair = async function(accountInfo, appPath){
    let fs = jetpack.cwd(appPath);
    fs.dir(`keys`);
    fs = jetpack.cwd(appPath, `keys`);

    // As the passphrase for the private key, use the dbPassword (the user account password).
    let appGeneralKey = (await Encrypt.keyDerivationFunction(accountInfo)).toString();
    let decryptedPassword = Encrypt.decryptAES256CBC(appGeneralKey,accountInfo.password);
    
    // Both the curve25519 and ed25519 curve options generate a primary key for signing using Ed25519 and 
    // a subkey for encryption using Curve25519.
    const { privateKey, publicKey, revocationCertificate } = await openpgp.generateKey({ // in base-64
        type: 'ecc', // Elliptic Curve 
        curve: 'curve25519', // ECC curve name 
        userIDs: [{ name: accountInfo.smtp.name, email: accountInfo.user}], // Multiple user IDs can be used.
        passphrase: decryptedPassword, // protects the private key
        format: 'armored' // output key format, defaults to 'armored' (other options: 'binary' or 'object')
    });

    fs.dir(`${Utils.md5(accountInfo.user)}`);
    fs = jetpack.cwd(appPath, `keys`, `${Utils.md5(accountInfo.user)}`);
    fs.write(`${accountInfo.user}-public.asc`, publicKey);
    fs.write(`${accountInfo.user}-private.asc`, privateKey);
    fs.write(`${accountInfo.user}-revocationCert.asc`, revocationCertificate);

    Encrypt.openPGPEncrypt(accountInfo, appPath);
}


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
    let fs = jetpack.cwd(appPath, `keys`, `${Utils.md5(accountInfo.user)}`);
    //const publicKeyArmored = await fs.readAsync(`${accountInfo.user}-public.asc`);
    const publicKeyArmored = await fs.readAsync(`publickey.nick-proton-test-1@protonmail.com-dd4942f57aa45c1ec122f2b1ad6d1f17ce33d747.asc`);
    //const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
    return publicKeyArmored;
}


Encrypt.getOwnPrivateKeyWithoutArmor = async function (accountInfo, appPath){
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
    let fs = jetpack.cwd(appPath, `keys`, `${Utils.md5(accountInfo.user)}`);

    const privateKeyArmored = await fs.readAsync(`${accountInfo.user}-private.asc`);

    // As the passphrase for decrypting the private key, use the dbPassword (the user account password).
    let appGeneralKey = (await Encrypt.keyDerivationFunction(accountInfo)).toString();
    let decryptedPassword = Encrypt.decryptAES256CBC(appGeneralKey, accountInfo.password);
    let passphrase = decryptedPassword;

    const privateKey = await openpgp.decryptKey({
        privateKey: await openpgp.readPrivateKey({ armoredKey: privateKeyArmored }),
        passphrase
    });

    return privateKey;
}


Encrypt.openPGPEncrypt = async function (accountInfo, appPath){
    let publicKey = Encrypt.getOwnPublicKeyWithoutArmor(accountInfo, appPath);
    let privateKey = Encrypt.getOwnPrivateKeyWithoutArmor(accountInfo, appPath);

    const plainData = await fs.readAsync("secrets.txt");
    console.log('PlainText: ');
    console.log(plainData);

    const encrypted = await openpgp.encrypt({
        message: await openpgp.createMessage({ text: plainData }), // input as Message object
        encryptionKeys: publicKey,
        signingKeys: privateKey // optional
    });
    console.log('Encrypted:')
    console.log(encrypted); // '-----BEGIN PGP MESSAGE ... END PGP MESSAGE-----'

    const message = await openpgp.readMessage({
        armoredMessage: encrypted // parse armored message
    });
    const { data: decrypted, signatures } = await openpgp.decrypt({
        message,
        verificationKeys: publicKey, // optional
        decryptionKeys: privateKey
    });
    
    console.log('Decrypted:')
    console.log(decrypted); 
    
    // check signature validity (signed messages only)
    try {
        await signatures[0].verified; // throws on invalid signature
        console.log('Signature is valid');
    } catch (e) {
        throw new Error('Signature could not be verified: ' + e.message);
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