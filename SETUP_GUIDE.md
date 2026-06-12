# Guide de mise en place — Connexion Gmail + Stripe + Sauvegarde automatique

Ce dossier contient tout le code backend (fonctions Netlify) nécessaire pour que ton tableau de bord
**Yassou Career** puisse :

- envoyer des emails depuis Gmail (avec pièces jointes) et lire l'historique des échanges,
- te connecter une fois pour toutes à Google (Gmail + Calendar) sans avoir à te reconnecter à chaque fois,
- synchroniser Stripe (paiements, solde, liens de paiement, clients),
- éditer le contenu des messages automatiques avant envoi (déjà présent dans ton fichier HTML — rien à faire),
- joindre des documents à n'importe quel email envoyé (déjà présent — rien à faire).

Le frontend (ton fichier `index.html`) appelle déjà ces fonctions à l'adresse `/.netlify/functions/...`.
Il ne te reste donc qu'à **ajouter ces fichiers à ton site** et **configurer les variables d'environnement**.

---

## 1. Où placer les fichiers

Dans le dossier de ton projet (celui connecté à Netlify), ajoute :

```
ton-projet/
├── index.html                          (déjà existant)
├── netlify.toml                        (nouveau)
├── package.json                        (nouveau)
└── netlify/
    └── functions/
        ├── lib/
        │   └── google-token.js         (nouveau)
        ├── google-auth-start.js        (nouveau)
        ├── google-auth-callback.js     (nouveau)
        ├── gmail.js                    (nouveau)
        ├── calendar.js                 (nouveau)
        └── stripe.js                   (nouveau)
```

Si tu as déjà un `netlify.toml` ou un `package.json`, **fusionne** leur contenu avec celui fourni
plutôt que de les remplacer.

---

## 2. Créer la table Supabase pour les tokens Google

Tes tokens Gmail/Calendar doivent être stockés côté serveur (et non dans le navigateur), pour que
la connexion reste active en permanence.

Dans Supabase → **SQL Editor**, exécute :

```sql
create table if not exists google_tokens (
  id text primary key,
  access_token text,
  refresh_token text,
  expiry_date timestamptz,
  scope text,
  updated_at timestamptz default now()
);

alter table google_tokens enable row level security;

-- Seule la clé "service_role" (utilisée côté serveur) peut lire/écrire cette table.
-- Aucune policy publique n'est créée : la table est inaccessible depuis le frontend.
```

> 💡 Tu as probablement déjà une table `app_state` pour les données du tableau de bord —
> c'est normal, `google_tokens` est une table séparée, uniquement utilisée par le backend.

---

## 3. Récupérer tes identifiants Google OAuth

Si tu as déjà un projet Google Cloud avec des identifiants OAuth, vérifie simplement les points
**3.3** et **3.4** (Gmail/Calendar API activées + URI de redirection). Sinon :

### 3.1 Créer le projet
1. Va sur [console.cloud.google.com](https://console.cloud.google.com/)
2. Crée un nouveau projet (ex. "Yassou Career")

### 3.2 Activer les API
Dans **APIs & Services → Library**, active :
- **Gmail API**
- **Google Calendar API**

### 3.3 Configurer l'écran de consentement OAuth
**APIs & Services → OAuth consent screen** :
- Type d'utilisateur : *External*
- Renseigne le nom de l'app, ton email
- Scopes à ajouter : `gmail.send`, `gmail.readonly`, `calendar`
- Ajoute ton adresse Gmail (yasmineguira@gmail.com) comme **utilisateur de test**
  (tant que l'app n'est pas "publiée", seuls les utilisateurs de test peuvent se connecter —
  c'est suffisant pour un usage personnel)

### 3.4 Créer les identifiants OAuth
**APIs & Services → Credentials → Create Credentials → OAuth client ID** :
- Type d'application : *Web application*
- **URI de redirection autorisée** :
  `https://TON-SITE.netlify.app/.netlify/functions/google-auth-callback`
  *(remplace `TON-SITE` par le vrai sous-domaine de ton site Netlify)*

Tu obtiens :
- un **Client ID**
- un **Client Secret**

---

## 4. Variables d'environnement à configurer sur Netlify

Va dans **Netlify → Site configuration → Environment variables** et ajoute :

| Variable | Valeur | Où la trouver |
|---|---|---|
| `GOOGLE_CLIENT_ID` | ton Client ID Google | Google Cloud Console → Credentials |
| `GOOGLE_CLIENT_SECRET` | ton Client Secret Google | Google Cloud Console → Credentials |
| `GOOGLE_REDIRECT_URI` | `https://TON-SITE.netlify.app/.netlify/functions/google-auth-callback` | doit correspondre EXACTEMENT à celle saisie en 3.4 |
| `SUPABASE_URL` | ex: `https://xxxxx.supabase.co` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_KEY` | la clé **service_role** (⚠️ secrète, jamais dans le frontend) | Supabase → Project Settings → API |
| `STRIPE_SECRET_KEY` | `sk_live_...` ou `sk_test_...` | Stripe → Developers → API keys |

> ⚠️ **Important** : `SUPABASE_SERVICE_KEY` est différente de la clé `anon` que tu utilises déjà
> dans le frontend (modal "Sauvegarde Supabase"). La clé `service_role` donne un accès complet
> à la base — elle ne doit JAMAIS être mise dans `index.html` ou exposée publiquement. Elle va
> uniquement dans les variables d'environnement Netlify (côté serveur).

Après avoir ajouté/modifié les variables, redéploie le site (Netlify → Deploys → Trigger deploy).

---

## 5. Connecter Gmail + Calendar

1. Ouvre ton tableau de bord déployé
2. Clique sur **"🔗 Connexion Google (Gmail/Calendar)"** dans la barre latérale
3. Connecte-toi avec **yasmineguira@gmail.com** (ou l'adresse depuis laquelle tu veux envoyer les emails)
4. Accepte les permissions Gmail + Calendar
5. Tu verras une page de confirmation "✅ Connexion Google réussie"

➡️ La connexion est désormais **permanente** : le token est stocké dans Supabase et se
rafraîchit automatiquement. Tu n'as à refaire cette étape que si tu révoques l'accès depuis
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

## 6. Tester

| Test | Où |
|---|---|
| Envoi d'email avec pièce jointe | Fiche client → "✉️ Nouveau message" → choisir un type → modifier le texte si besoin → ajouter un fichier en pièce jointe → "Envoyer via Gmail" |
| Historique des échanges | Fiche client → "📬 Échanges email" |
| Synchronisation Stripe | Onglet **Stripe** → "⟳ Synchroniser" |
| Solde Stripe en direct | Dashboard → icône ⟳ sur la carte "Chiffre d'affaires encaissé" |
| Créer un lien de paiement | Onglet **Stripe** → "Créer un lien" |
| Créer un client Stripe | Onglet **Stripe** → "Créer un client Stripe" |
| Synchroniser Google Calendar | Selon la vue où le bouton est présent |

---

## 7. Ce qui est déjà géré côté frontend (rien à faire)

- **Édition des messages automatiques** : avant l'envoi, le texte généré apparaît dans une zone
  de texte modifiable ("✏️ Corps du message") — tu peux tout réécrire avant de cliquer sur "Envoyer".
- **Pièces jointes** : le champ "📎 Pièces jointes" permet d'ajouter un ou plusieurs fichiers
  (CV, LinkedIn, etc.) à n'importe quel type de message. Pour le message de "Bienvenue", les CGS
  (`Conditions_Generales_Yassou_Career.pdf`) sont jointes automatiquement si ce fichier est présent
  à la racine du site.
- **Enregistrement automatique** : chaque email envoyé met à jour la fiche client
  (`lastEmail`) et est persisté automatiquement dans Supabase (table `app_state`) si la sauvegarde
  Supabase est configurée dans la sidebar.

---

## 8. En cas d'erreur

| Message | Cause probable |
|---|---|
| "Connexion Google non initialisée…" | L'étape 5 n'a pas été faite, ou les tokens ont expiré/révoqués |
| "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI manquants" | Variables d'environnement non configurées (étape 4) |
| "Pas de refresh token reçu" | Révoque l'accès sur myaccount.google.com/permissions puis recommence l'étape 5 |
| "SUPABASE_URL / SUPABASE_SERVICE_KEY manquants" | Variables Supabase non configurées (étape 4) |
| "Connexion Stripe indisponible" | `STRIPE_SECRET_KEY` manquant ou invalide |
| Erreur 404/400 sur `google_tokens` | La table n'a pas été créée (étape 2) |

---

Une fois ces étapes faites, **tout fonctionne automatiquement** : pas besoin de ressaisir de
clés à chaque session, la connexion Gmail/Calendar et Stripe reste active en permanence.
