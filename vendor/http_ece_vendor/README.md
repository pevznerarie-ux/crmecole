# http-ece (vendored)

Copie locale du paquet PyPI `http-ece` v1.2.1 (RFC 8188 `aes128gcm`), dont
dépend `pywebpush` pour le Web Push. Le sdist officiel sur PyPI échoue à se
construire avec les versions récentes de setuptools (`AttributeError:
install_layout`) ; ce paquet local, reconstruit avec un `pyproject.toml`
moderne autour du même code source (inchangé, licence MIT, auteur Martin
Thomson), permet à `pip install -r requirements.txt` de satisfaire la
dépendance `http-ece>=1.1.0` de `pywebpush` sans jamais contacter PyPI pour
ce paquet précis.
