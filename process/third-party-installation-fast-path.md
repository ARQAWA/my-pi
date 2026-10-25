## Third-party installation fast path

For an agreed third-party library or Pi extension, first install it into the owner's Pi so it works immediately,
then add it to the `my-pi` package. At first use, consult Pi's documentation to decide how one Pi package bundles
another; do not preselect a packaging mechanism. Preserve credentials and unrelated settings.
Self-review the config and exact diff for unintended additions, commit and push to the destination in
[Delivery](../PROCESS.md#delivery). This narrow path
replaces the full Delivery pipeline, including the local test gate and independent reviews, for third-party installation
and package configuration only. It does not apply to building our own features or mechanisms or to this process
and guard change. Record the accepted choice in `DECISIONS.md`.
