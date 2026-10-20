# Prints a Microsoft Entra token for the Marketplace from the az login cache (~/.azure).
# Run with az's own Python packages:
#   PYTHONPATH=$(ls -d /opt/homebrew/Caskroom/azure-cli/*/libexec/lib/python3*/site-packages | tail -1) python3 mp_token.py
import os, sys, msal

cache = msal.SerializableTokenCache()
cache.deserialize(open(os.path.expanduser('~/.azure/msal_token_cache.json')).read())
# Azure CLI public client id; 499b84ac-... is the Azure DevOps / Marketplace resource
app = msal.PublicClientApplication('04b07795-8ddb-461a-bbee-02f9e1bf7b46',
                                   authority='https://login.microsoftonline.com/organizations', token_cache=cache)
accounts = app.get_accounts()
r = app.acquire_token_silent(['499b84ac-1321-427f-aa17-267ca6975798/.default'], account=accounts[0] if accounts else None)
if not r or 'access_token' not in r:
    sys.exit('no token: run az login --allow-no-subscriptions --use-device-code')
print(r['access_token'])
