// Load modules

var Utils = require('./utils');
var Crypto = require('./crypto');


// Declare internals

var internals = {};


internals.defaults = {
    ttl: 60 * 60 * 1000,        // 1 hour
    ticketSecretBits: 256,      // Ticket secret size in bits

    ticketEncryptionKey: {
        saltBits: 256,
//        algorithm: 'aes-128-ctr',             // Requires node 0.9.x
        algorithm: 'aes-256-cbc',
        iterations: 1
    },

    ticketMacKey: {
        saltBits: 256,
        algorithm: 'sha256',
        iterations: 1
    },

    ticketPassword: 'example'
};


/*
    var app = {
        id: '123',                  // Client id
        ttl: 5 * 60 * 1000,         // 5 min
        scope: ['a', 'b']           // Client scope
    };


    var user = {
        id: '456'                   // User id
    };


    var options = {
        ttl: 60 * 1000,             // 1 min
        ext: { tos: '0.0.1' },      // Server-specific extension data
        scope: ['b']                // Ticket-specific scope
    };
*/

exports.issue = function (app, user, options, callback) {

    options = options || {};

    // Generate ticket secret

    Crypto.randomBits(internals.defaults.ticketSecretBits, function (err, random) {

        if (err) {
            return callback(err);
        }

        // Construct object

        var ttl = options.ttl || app.ttl || internals.defaults.ttl;

        var object = {
            key: random.toString('hex'),
            app: app.id,
            scope: options.scope || app.scope,
            exp: Date.now() + ttl
        };

        if (user) {
            object.user = user.id;
        }

        if (options.ext) {
            object.ext = options.ext
        }

        // Stringify and encrypt

        var ObjectString = JSON.stringify(object);

        Crypto.encrypt(internals.defaults.ticketPassword, internals.defaults.ticketEncryptionKey, ObjectString, function (err, encrypted, key) {

            if (err) {
                return callback(err);
            }

            // Base64url the encrypted value

            var encryptedB64 = Utils.base64urlEncode(encrypted);
            var encryptedWithSalt = key.salt + ':' + encryptedB64;
            var iv = Utils.base64urlEncode(key.iv);

            // Mac the combined values

            var hmac = Crypto.hmacBase64url(internals.defaults.ticketPassword, internals.defaults.ticketMacKey, encryptedWithSalt, function (err, mac) {

                if (err) {
                    return callback(err);
                }

                // Put it all together

                var ticket = mac.salt + ':' + mac.digest + ':' + encryptedWithSalt + ':' + iv;        // hmac-salt:hmac:encryption-salt:encrypted:encryption-iv

                var result = {
                    ticket: ticket,
                    key: object.key,
                    ttl: ttl,
                    scope: object.scope
                };

                return callback(null, result);
            });
        });
    });
};


// Parse ticket

exports.parse = function (ticket, callback) {

    // Break string into components

    var parts = ticket.split(':');
    if (parts.length !== 5) {
        return callback(new Error('Incorrect number of ticket components'));
    }

    var hmacSalt = parts[0];
    var hmac = parts[1];
    var encryptedSalt = parts[2];
    var encryptedB64 = parts[3];
    var encryptedIv = parts[4];
    var encryptedWithSalt = encryptedSalt + ':' + encryptedB64;

    // Check hmac

    var macOptions = Utils.clone(internals.defaults.ticketMacKey);
    macOptions.salt = hmacSalt;

    Crypto.hmacBase64url(internals.defaults.ticketPassword, macOptions, encryptedWithSalt, function (err, mac) {

        if (err) {
            return callback(err);
        }

        if (hmac !== mac.digest) {
            return callback(new Error('Bad hmac value'));
        }

        // Decrypt ticket

        var encrypted = Utils.base64urlDecode(encryptedB64);

        if (encrypted instanceof Error) {
            return callback(encrypted);
        }

        var decryptOptions = Utils.clone(internals.defaults.ticketEncryptionKey);
        decryptOptions.salt = encryptedSalt;
        decryptOptions.iv = Utils.base64urlDecode(encryptedIv);

        Crypto.decrypt(internals.defaults.ticketPassword, decryptOptions, encrypted, function (err, decrypted) {

            // Parse JSON into object

            var object = null;
            try {
                object = JSON.parse(decrypted);
            }
            catch (err) {
                return callback(new Error('Failed parsing ticket JSON: ' + err.message));
            }

            return callback(null, object);
        });
    });
};



