# Review a local S3 connection

Start a disposable AWS emulator with S3, SQS and DynamoDB on a random loopback HTTPS port. Supply its public CA certificate and a new output directory. The fixture uses the AWS CLI with isolated test credentials. Use an emulator that accepts unsigned or fixture requests. The read failure exercises a missing object.

From the Lens checkout, install the locked dependencies with Node 24 and run the following command with values from your local emulator.

```sh
node examples/aws-connection-review/run.mjs "https://127.0.0.1:$DEMO_PORT" "$DEMO_CA" "$DEMO_OUTPUT"
```

The demo creates a reports bucket, a DynamoDB table, a jobs queue and its dead-letter queue. A reader on the laptop issues a real GetObject request. Removing and restoring the object produces three independent FootPrint recordings. The fixture removes its four resources on exit. TLS and routing are configured declarations. The probe records the result of the object request.

A declaration can supply just the fields it knows.

```js
chart.connect(reader, reports, 'communicatesWith', 'Read report', {
  operation: 'GetObject',
  protocol: { application: 'HTTPS', transport: 'TCP', port: 443 },
  route: { network: 'IPv4', via: ['S3 gateway endpoint'] }
})
```

For registered Running system diagrams pass the same `details` to the topology connection. Bind its `checkIds` to the host's recorded checks. Selecting the connection opens the declared fields and available evidence. The demo itself uses the emulator's loopback port and path.
