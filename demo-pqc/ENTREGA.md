# Algoritmo post-cuántico: ML-KEM-768 (NIST FIPS 203)

## Herramienta de IA generativa
Claude Code (modelo Claude Sonnet 5.5, `claude-sonnet-5-5`).

## Prompts usados
1. "Implementar un algoritmo post-cuántico de acuerdo a las especificaciones de NIST. El programa debe generar una llave y secreto, encriptar y posteriormente desencriptar el mismo."
2. "Hazme este código de manera sencilla."

## Cómo ejecutar
```
npm install --save-exact @noble/post-quantum@0.7.1
node ml-kem-demo.mjs
```
Requiere Node 18 o superior.

## Qué hace
ML-KEM-768 (antes CRYSTALS-Kyber, estandarizado en FIPS 203) es un mecanismo de encapsulación de llaves, no cifra mensajes directamente. Por eso:
1. Genera la llave pública y la llave secreta.
2. Encapsula: produce un secreto compartido de 32 bytes y su texto cifrado.
3. Encripta el mensaje con AES-256-GCM usando ese secreto.
4. Desencapsula con la llave secreta, recupera el mismo secreto y desencripta el mensaje.

Librería: `@noble/post-quantum` 0.7.1 (implementación de FIPS 203 en JavaScript).

## Código
Ver `ml-kem-demo.mjs`.

## Criterios de aceptación o falla
Aceptación (el programa sale con código 0):
- Las llaves se generan con tamaños de ML-KEM-768: pública 1184 bytes, secreta 2400 bytes.
- El secreto compartido del emisor es igual al del receptor.
- El mensaje desencriptado es idéntico al original.

Falla (código 1): cualquiera de las comprobaciones anteriores no coincide, o la autenticación de AES-GCM rechaza el mensaje.

## Resultado de la corrida
Llave pública 1184 bytes, llave secreta 2400 bytes, secretos iguales: OK, mensaje recuperado igual: OK.
