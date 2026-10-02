# Ajouter une boutique

L'outil accepte autant de boutiques Shopify qu'on veut. Mais une appli Shopify
en **distribution personnalisée** ne s'installe que sur **une seule boutique** :
Shopify refuse son lien partout ailleurs (« Le lien d'installation de cette
appli n'est pas valide »). Chaque nouvelle boutique a donc **sa propre appli**.

Compter 5 minutes par boutique.

## 1. Créer l'appli dans le Partner Dashboard

1. Shopify Partners → **Applis** → **Créer une appli** → *Créer l'appli manuellement*.
   Nommez-la par exemple « Resolve – Nom de la boutique ».
2. **Configuration** de l'appli :
   - **URL de l'appli** : `https://<votre domaine>/auth/shopify`
   - **URL de redirection autorisée** : `https://<votre domaine>/auth/shopify/callback`

   Les deux adresses exactes sont affichées dans la console `/admin`, section
   « Boutiques Shopify » : copiez-les de là.
3. **Distribution** → *Distribution personnalisée* → saisissez le domaine
   `ma-boutique.myshopify.com` de la boutique.
4. Notez le **Client ID** et le **Client secret** de l'appli (onglet
   *Présentation* / *Identifiants*).

## 2. L'enregistrer dans l'outil

Console `/admin` → **Boutiques Shopify** :

- Domaine de la boutique : `ma-boutique.myshopify.com`
- Client ID et Client secret de l'étape 1
- **Enregistrer l'appli**

Le secret est chiffré et ne se réaffiche jamais.

## 3. Installer

Cliquez **Installer** sur la ligne de la boutique (ou ouvrez le lien
d'installation généré par le Partner Dashboard). La boutique s'installe, puis
l'outil propose de connecter sa boîte Gmail, comme pour la première.

Lancée depuis le tableau de bord d'un compte **Propriétaire** déjà connecté
(même navigateur), la nouvelle boutique rejoint son groupe et son compte.

## Bon à savoir

- Une boutique **sans** appli propre passe par l'appli par défaut de la
  plateforme (`SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`, section « Application
  Shopify » de la console) : les boutiques déjà branchées ne changent rien.
- **Retirer** une appli dans la console fait repasser la boutique par l'appli
  par défaut. Si celle-ci ne peut pas s'installer sur la boutique, il faudra
  réenregistrer son appli.
- Si l'outil a un jour besoin d'une nouvelle autorisation Shopify, chaque
  boutique devra la réaccepter (réinstallation depuis la console).
- Pour des centaines de boutiques qui s'installent seules, la voie suivante
  est une appli **publique** (non listée) ; elle coexistera avec celles-ci.
