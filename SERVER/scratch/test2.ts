import { customerService } from '../src/services/customer.service';

async function main() {
  const customer = await customerService.getCustomerByPhone('9412944335');
  console.log('Customer via Service:', customer);
}

main().catch(console.error);
