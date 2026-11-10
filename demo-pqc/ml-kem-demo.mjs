// Demo ML-KEM-768 (FIPS 203, NIST) + AES-256-GCM
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const mensaje = "Hola, este mensaje esta protegido con criptografia post-cuantica.";

// 1. Generar llave publica y llave secreta
const { publicKey, secretKey } = ml_kem768.keygen();
console.log("Llave publica :", publicKey.length, "bytes");
console.log("Llave secreta :", secretKey.length, "bytes");

// 2. Encapsular: crea el secreto compartido y su cifrado (cipherText)
const { cipherText: kemCt, sharedSecret: secretoEmisor } = ml_kem768.encapsulate(publicKey);

// 3. Encriptar el mensaje con el secreto compartido (AES-256-GCM)
const iv = randomBytes(12);
const cifrador = createCipheriv("aes-256-gcm", secretoEmisor, iv);
const cifrado = Buffer.concat([cifrador.update(mensaje, "utf8"), cifrador.final()]);
const tag = cifrador.getAuthTag();
console.log("Mensaje cifrado:", cifrado.toString("hex"));

// 4. Desencapsular con la llave secreta y desencriptar
const secretoReceptor = ml_kem768.decapsulate(kemCt, secretKey);
const descifrador = createDecipheriv("aes-256-gcm", secretoReceptor, iv);
descifrador.setAuthTag(tag);
const claro = Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString("utf8");
console.log("Mensaje descifrado:", claro);

// 5. Criterios de aceptacion
const secretosIguales = Buffer.from(secretoEmisor).equals(Buffer.from(secretoReceptor));
const mensajeIgual = claro === mensaje;
console.log("\nSecretos compartidos iguales:", secretosIguales ? "OK" : "FALLA");
console.log("Mensaje recuperado igual    :", mensajeIgual ? "OK" : "FALLA");
process.exit(secretosIguales && mensajeIgual ? 0 : 1);
