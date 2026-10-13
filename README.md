# Portfolio — Sarra Jouini

Site statique (HTML / CSS / JS, sans framework). Ouvrir `index.html` suffit pour le voir en local.

```
portfolio/
├── index.html          ← contenu du site
├── style.css           ← design (clair / sombre, responsive)
├── script.js           ← animations, filtres, lightbox
└── assets/
    ├── cv/             ← les 2 CV téléchargeables
    ├── img/credit/     ← 4 dashboards NextCredit
    ├── img/co2/        ← 6 dashboards CO₂ (extraits du rapport)
    ├── img/airbnb/     ← 2 dashboards Airbnb
    └── video/          ← À AJOUTER : creditrisk.mp4 et co2.mp4
```

## Avant de publier (à faire)

1. **Vidéos** : copier les démos dans `assets/video/` avec exactement ces noms : `creditrisk.mp4` et `co2.mp4`.
   - GitHub refuse les fichiers > 100 Mo (et > 25 Mo par l'upload web). Si besoin, compresser avec **HandBrake** (preset « Fast 1080p30 »).
   - Alternative : mettre les vidéos sur **YouTube en « Non répertoriée »** et remplacer la balise `<video>` par l'`<iframe>` indiquée en commentaire dans `index.html`.
2. **LinkedIn / GitHub** : remplacer `VOTRE-PROFIL` et `VOTRE-PSEUDO` dans la section Contact de `index.html`.
3. Relire les **dates d'expérience** (les deux CV ne donnent pas exactement les mêmes).

---

## Option 1 — GitHub Pages (recommandé, gratuit, URL pro)

Résultat : `https://VOTRE-PSEUDO.github.io`

1. Créer un compte sur https://github.com.
2. Cliquer **New repository**, le nommer **exactement** `VOTRE-PSEUDO.github.io`, cocher *Public*, **Create**.
3. Envoyer les fichiers :
   - *Sans ligne de commande* : installer **GitHub Desktop**, cloner le dépôt, copier le **contenu** du dossier `portfolio` dedans, puis *Commit* → *Push*.
   - *Avec git* :
     ```
     cd portfolio
     git init
     git add .
     git commit -m "Mon portfolio"
     git branch -M main
     git remote add origin https://github.com/VOTRE-PSEUDO/VOTRE-PSEUDO.github.io.git
     git push -u origin main
     ```
4. Sur GitHub : **Settings → Pages → Source : Deploy from a branch → main / (root) → Save**.
5. Attendre 1–2 minutes : le site est en ligne. Chaque nouveau *push* le met à jour.

Bonus : votre dépôt public sert aussi de preuve de compétences pour les recruteurs.

## Option 2 — Netlify Drop (le plus rapide : 30 secondes)

1. Aller sur https://app.netlify.com/drop
2. Glisser-déposer le dossier `portfolio` entier.
3. Créer un compte gratuit pour garder le site, puis **Site settings → Change site name** → `sarra-jouini.netlify.app`.

Limite : pour mettre à jour, il faut re-glisser le dossier (ou connecter le dépôt GitHub).

## Option 3 — Vercel

https://vercel.com → *Add New Project* → importer le dépôt GitHub → *Deploy*. URL : `sarra-jouini.vercel.app`.

## Nom de domaine perso (optionnel, ~10 €/an)

Acheter `sarrajouini.com` (Namecheap, OVH, Porkbun), puis dans GitHub **Settings → Pages → Custom domain**. HTTPS est offert.

## Après la mise en ligne

- Ajouter le lien dans votre **CV**, votre **profil LinkedIn** (section *Sélection* + *Coordonnées*) et votre signature email.
- Tester sur téléphone et partager le lien.
