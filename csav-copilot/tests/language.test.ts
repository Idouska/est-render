import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLanguage } from '../src/services/ai/language.ts';

test('reconnaît un message français', () => {
  assert.equal(
    detectLanguage("Bonjour, je n'ai pas reçu ma commande, pouvez-vous vérifier la livraison ?"),
    'fr',
  );
});

test('reconnaît un message anglais', () => {
  assert.equal(
    detectLanguage('Hello, I have not received the order yet. Can you please check the delivery?'),
    'en',
  );
});

test('reconnaît l’espagnol et l’allemand', () => {
  assert.equal(detectLanguage('Hola, no he recibido mi pedido, gracias por su ayuda'), 'es');
  assert.equal(detectLanguage('Hallo, ich habe die Bestellung nicht erhalten, danke'), 'de');
});

test('un mot isolé ne suffit pas à basculer de langue', () => {
  // « The » vient du nom du produit, le message est français.
  assert.equal(
    detectLanguage('Bonjour, ma commande The Nike Mind est en retard, merci de vérifier'),
    'fr',
  );
});

test('retombe sur le français quand le message est vide', () => {
  assert.equal(detectLanguage(''), 'fr');
});
